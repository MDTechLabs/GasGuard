## Summary

This pull request introduces a new security rule to detect potentially unsafe operations in Soroban contracts. The rule flags a variety of patterns that can lead to security vulnerabilities and unexpected behavior, providing developers with actionable recommendations to improve the safety and reliability of their contracts.

## What Changed

- Implemented a new security rule, `detect-unsafe-operations`, to identify unsafe patterns in Soroban contracts.
- The rule detects the following unsafe operations:
  - `unsafe` blocks
  - `unsafe fn`
  - `.unwrap()` calls
  - `panic!` macros
  - `unreachable!` macros
  - `std::mem::transmute`
  - Raw pointer usage
  - Unchecked arithmetic operators
- For each detected violation, the rule provides a detailed description of the issue and a recommendation for how to fix it.

## Why

The use of unsafe operations in Soroban contracts can introduce serious security vulnerabilities, such as memory corruption, integer overflows, and unexpected panics. By detecting these patterns and providing clear guidance on how to avoid them, this new rule helps developers write more secure and robust contracts.

## Testing Performed

- [x] Lint
- [x] Tests
- [x] Build

## Edge Cases Considered

- The rule correctly handles a variety of code formatting and style variations.
- The rule avoids false positives by ignoring non-arithmetic uses of `+`, `-`, and `*` operators.

## Risks

None. The new rule is purely additive and does not introduce any breaking changes.

Closes #496