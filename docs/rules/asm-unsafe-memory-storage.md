# Unsafe assembly memory and storage operations (`GG-ASM-MEM-001`)

Detector: `rules/security/assembly/detect-unsafe-assembly.ts` · Tests: `rules/security/assembly/__tests__/detect-unsafe-assembly.spec.ts`

## What it detects

Every inline `assembly { ... }` block is scanned for memory and storage writes that break Solidity's memory model or its storage layout. Returns the normalized `RuleResult` plus `blocks` (number of assembly blocks inspected).

| `kind` | Meaning | Severity |
| --- | --- | --- |
| `free-pointer-corruption` | `mstore(0x40, <literal below 0x80>)` points the free pointer into scratch/reserved memory. | high |
| `zero-slot-overwrite` | Non-zero `mstore(0x60, ...)` with no `mstore(0x60, 0)` restore in the block. | medium |
| `unallocated-memory-write` | Write at `mload(0x40)` (or a local read from it) while the block never advances the pointer and does not `return`/`revert`. | medium |
| `memory-safe-violation` | Block annotated `("memory-safe")` writes to a fixed offset at or above 0x40. | medium |
| `fixed-storage-slot-write` | `sstore(<literal below 0x10000>, v)` overlaps slots Solidity gives to state variables. | medium |
| `user-controlled-storage-slot` | `sstore` slot derived from a parameter or `calldataload` without hashing. High for unguarded public/external functions, medium when internal or modifier-guarded. | high / medium |

## Accepted patterns

Namespaced slots (`keccak256(...)`, `x.slot`, `CONSTANT_NAMES`, large literals such as ERC-1967 slots), pointer writes followed by `mstore(0x40, add(ptr, size))`, and blocks that end in `return`/`revert`.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x, one source string; Yul is read lexically (no control-flow graph) and user-defined Yul functions are not followed.
- Slot and pointer provenance is tracked through `let`/`:=` bindings inside one block, to depth four.
- Malformed, empty, oversized or non-Solidity input returns `analyzed: false` with diagnostics; no project scripts or configuration are executed.
- False positives: a low literal slot used on purpose (for example a legacy proxy layout) can be accepted by naming it as a constant.

## Fixtures

Vulnerable: `assembly { mstore(0x40, 0x20) }`, `function set(bytes32 slot, uint256 v) external { assembly { sstore(slot, v) } }`.
Safe: `let ptr := mload(0x40) mstore(ptr, 1) mstore(0x40, add(ptr, 0x20))`. More cases are in the spec.
