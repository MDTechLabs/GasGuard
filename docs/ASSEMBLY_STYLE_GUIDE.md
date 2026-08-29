# Assembly Style Guide

## Overview

This guide establishes a consistent inline documentation standard for all Yul assembly blocks across the GasGuard repository. The goal is to maintain gas efficiency while ensuring that assembly code remains readable, auditable, and maintainable.

## Stack State Annotations

Every assembly block must include a stack state annotation above it using the format:

```
// [arg1, arg2] -> [result]
```

This annotation describes the stack effect of the assembly block:
- **Left side** (`[arg1, arg2]`): The values on the stack before the block executes, listed in bottom-to-top order.
- **Right side** (`[result]`): The value(s) left on the stack after the block executes, listed in bottom-to-top order.

### Examples

```solidity
// [value] -> [hash]
assembly {
    hash := keccak256(0x00, 0x20)
}
```

```solidity
// [a, b] -> [result]
assembly {
    mstore(0x00, a)
    mstore(0x20, b)
    result := keccak256(0x00, 0x40)
}
```

```solidity
// [slot] -> [value]
assembly {
    value := sload(slot)
}
```

## Memory Layout Conventions

### Scratch Memory (0x00–0x40)

Scratch memory is reserved for temporary computation within assembly blocks. It is the only memory region that may be used for intermediate hash computations without affecting the free memory pointer.

- **0x00–0x1F**: First 32-byte word (scratch slot A)
- **0x20–0x3F**: Second 32-byte word (scratch slot B)

All scratch memory usage must be explicitly commented above the assembly block.

### Free Memory Pointer (0x40)

The free memory pointer at `0x40` must never be modified inside assembly blocks unless the block's purpose is explicitly memory allocation. All assembly blocks that use scratch memory must preserve the free memory pointer.

```solidity
// Uses scratch memory 0x00-0x40 only; does not modify 0x40 (free memory pointer).
// [a, b] -> [hash]
assembly {
    mstore(0x00, a)
    mstore(0x20, b)
    hash := keccak256(0x00, 0x40)
}
```

## Safety Invariants

Every assembly block must declare its safety invariants in a comment directly above the block. Required invariants:

1. **Memory safety**: State whether the block modifies memory beyond scratch (0x00–0x40).
2. **Storage safety**: State whether the block reads or writes storage.
3. **Reentrancy safety**: State whether the block makes external calls.
4. **Gas safety**: Note any operations with variable gas costs (e.g., `SLOAD`, `SSTORE`, `KECCAK256`).

### Example

```solidity
// Safety invariants:
// - Memory: reads scratch 0x00-0x40 only; does not write beyond scratch.
// - Storage: reads slot; does not write storage.
// - Reentrancy: no external calls.
// - Gas: SLOAD (2100 warm / 100 cold), KECCAK256 (quadratic word cost).
// [slot] -> [value]
assembly {
    value := sload(slot)
}
```

## Required Comment Format

Each assembly block must have exactly two comment lines directly above it:

1. **Stack state annotation** (required): `// [args] -> [results]`
2. **Safety invariants** (required): One or more lines starting with `// Safety:`

### Correct Example

```solidity
// [key, slot] -> [result]
// Safety: reads scratch 0x00-0x40 only; no storage writes; no external calls.
assembly {
    mstore(0x00, key)
    mstore(0x20, slot)
    result := keccak256(0x00, 0x40)
}
```

### Incorrect Example

```solidity
assembly {
    mstore(0x00, key)
    mstore(0x20, slot)
    result := keccak256(0x00, 0x40)
}
```

The incorrect example is missing both the stack state annotation and the safety invariants.

## Variable Naming in Assembly

- Use `camelCase` for Yul local variables.
- Use descriptive names that reflect the value's purpose (e.g., `baseSlot`, `innerSlot`, `leafHash`).
- Avoid single-letter variable names except for loop counters (`i`, `j`).

## Loop Patterns

Loops in assembly must include an invariant comment and a termination guarantee:

```solidity
// [i, accumulator] -> [result]
// Safety: reads scratch 0x00-0x40 only; no storage writes; no external calls.
// Invariant: accumulator holds the running hash of all processed elements.
// Terminates when i == proofLength.
assembly {
    for { let i := 0 } lt(i, proofLength) { i := add(i, 1) } {
        // loop body
    }
}
```

## Applying This Guide

All Yul assembly blocks in `contracts/utils/` and other directories must be annotated according to this standard. When adding new assembly blocks, follow the format above. When reviewing code, verify that every assembly block has both a stack state annotation and safety invariants.