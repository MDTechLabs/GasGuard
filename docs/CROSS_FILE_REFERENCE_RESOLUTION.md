# Cross-File Reference Resolution

Rules that look at one file at a time cannot tell where an imported symbol comes from. Cross-file
resolution builds the import graph for a repository snapshot, indexes top-level definitions, and
resolves each use of an imported symbol to the file and line that defines it.

| Layer | Location |
| --- | --- |
| Resolver (pure, engine) | `libs/engine/core/cross-file-resolver.ts` |
| Fixtures | `tests/fixtures/cross-file-resolution/` |
| Tests | `libs/engine/core/cross-file-resolver.spec.ts` |

## Public interface

```ts
import {
  resolveCrossFileReferences,
  getAffectedFiles,
  getReferencesTo,
  parseRemappings,
} from '@engine/core/cross-file-resolver';

const resolution = resolveCrossFileReferences(
  [{ path: 'contracts/Vault.sol', content: '...' }, /* ... */],
  { remappings: parseRemappings(remappingsTxt) },
);
```

- `resolveCrossFileReferences(sources, options)` returns a `CrossFileResolution`
  (`schemaVersion`, `files`, `skippedFiles`, `symbols`, `imports`, `references`, `dependencies`,
  `cycles`, `issues`, `counts`).
- `getAffectedFiles(resolution, changedFiles)` returns the changed files plus all transitive
  importers. Use it to widen `AnalyzerConfig.changedFiles` when `changedFilesOnly` is set, so a
  change to a base contract re-analyzes its dependents.
- `getReferencesTo(resolution, file, name)` lists every use that resolves to a definition.
- `parseRemappings(text)` parses a `remappings.txt` body.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `remappings` | `{}` | Solidity `prefix -> target` remappings. The longest matching prefix wins. |
| `rootDir` | none | Absolute root used to relativize absolute input paths. |
| `maxFiles` | `5000` | Files beyond this count (after sorting by path) are skipped with `TOO_MANY_FILES`. |
| `maxFileBytes` | `1048576` | Larger files are skipped with `FILE_TOO_LARGE`. |

There are no other switches. Languages are chosen by extension.

## Supported languages

| Language | Extensions | Imports understood | Symbols indexed (top level) |
| --- | --- | --- | --- |
| Solidity | `.sol` | `import "x"`, `import "x" as N`, `import * as N from "x"`, `import {A, B as C} from "x"`, remappings | contract, interface, library, struct, enum, event, error, function, user-defined type, constant |
| Rust | `.rs` | `mod x;`, `use crate::/self::/super::` paths, `{}` groups, `as`, `*`, `pub use` / `pub mod` re-exports | fn, struct, enum, trait, type, const, static, union |
| Vyper | `.vy`, `.vyi` | `import a.b as c`, `from a import B`, `from . import m`, relative dots | def, struct, event, interface, flag, enum, constants |

Solidity plain imports (`import "x";`) and symbol imports are transitively visible to importers, as
in the Solidity compiler. Rust and Vyper imports are not re-exported unless marked `pub use`.

## Output semantics

- **Imports** have a `status`:
  - `resolved`: the target is in the snapshot (`resolvedPath` is set).
  - `external`: the specifier points outside the snapshot (`@openzeppelin/...` with no vendored
    copy, `std::...`, `ethereum.ercs`). Not an error.
  - `unresolved`: a relative import, `mod`, or in-repo `use` whose target is missing. Raises
    `UNRESOLVED_IMPORT`.
- **References** have a `status`:
  - `resolved` with a single `target` definition.
  - `ambiguous` with all `candidates`, when two plain imports provide the same name
    (`AMBIGUOUS_SYMBOL`).
  - `external` when the symbol comes from an external import.
  - `unresolved` when the import resolved but defines no such symbol (`UNRESOLVED_SYMBOL`).
- Comments and string contents are never counted as references. A definition in the same file
  shadows an import of the same name. `a.b` member accesses are not treated as imports of `b`.
- Namespace uses (`Errors.ZeroAmount`, `math::sub`) are reported with the member as `name` and the
  namespace as `via`.
- `cycles` lists strongly connected import groups; each also raises one `IMPORT_CYCLE` issue.
  Resolution terminates on cycles.

## Failure semantics

| Situation | Behavior |
| --- | --- |
| Unsupported extension | File listed in `skippedFiles`, issue `UNSUPPORTED_LANGUAGE`. |
| Path is empty, absolute outside `rootDir`, or escapes the root (`..`) | File dropped, `INVALID_PATH`. Relative imports that climb above the root are `unresolved`. |
| Duplicate path | One copy kept (smallest content, so input order does not matter), `DUPLICATE_PATH`. |
| File too large / too many files | Skipped, `FILE_TOO_LARGE` / `TOO_MANY_FILES`. |
| Exception while processing one file | `PARSE_ERROR` for that file; every other file is still resolved. |
| Empty input | Empty resolution with no issues. |

The resolver never throws for bad repository input and never returns a partial result silently:
every skipped or degraded item has an entry in `issues`.

## Determinism, retries and tenancy

- The function is pure: no I/O, clock, randomness or module state. For the same sources and
  options it returns byte-identical output, whatever order the sources arrive in. Every list is
  sorted (by path, line, column, name).
- A worker can retry a failed job freely; there is nothing to clean up. Persist or cache results
  keyed by commit SHA, `options` and rule-pack version.
- It only sees the sources passed in, so tenants are isolated as long as one call is made per
  tenant repository. Paths in the output are repository-relative.

## Backward compatibility

The module is additive. No existing interface changed, analyzers that ignore it behave exactly as
before, and `schemaVersion` is bumped when the output shape changes.

## Limits

Resolution is lexical, not a full parse: names inside function bodies are matched by identifier, so
a local variable that shares a name with an imported symbol is counted as a reference. Contract
members, inline Rust modules and Solidity `using ... global` are not indexed.
