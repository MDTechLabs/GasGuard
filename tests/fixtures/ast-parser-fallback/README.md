# AST parser fallback fixtures

Used by `libs/engine/core/ast-parser-fallback.spec.ts`. These files only need to be readable text;
they are never compiled.

| Fixture | Purpose |
| --- | --- |
| `realistic-repo/` | A small mixed repository. `Token.sol`, `Vault.sol`, `lib.rs` and `vault.vy` are valid; `Future.sol` uses a keyword a strict parser rejects (`transient`); `Broken.sol` is a half-edited file with an unclosed block; `NOTES.md` has no parser. |
| `regression/` | Inputs that broke naive outlining: braces inside strings and comments, `;` inside Rust array types, and indentation-delimited Vyper blocks. |
