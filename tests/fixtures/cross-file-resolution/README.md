# Cross-file reference resolution fixtures

Used by `libs/engine/core/cross-file-resolver.spec.ts`. Each directory is a repository snapshot;
the spec loads every file under it and runs `resolveCrossFileReferences`.

| Fixture | Purpose |
| --- | --- |
| `realistic-solidity/` | Foundry-style layout: remappings, named/aliased/namespace/plain imports, an external (`@openzeppelin`) import, and symbols mentioned only in comments and strings. |
| `regression/` | Import cycle, transitive re-export through a plain import, ambiguous symbol from two plain imports, and an unresolved relative import. |
| `rust-crate/` | `mod`, `use crate::`, `use super::`, brace imports, `pub use` re-export and namespace paths. |

Do not compile these files; they only need to be parseable by the resolver.
