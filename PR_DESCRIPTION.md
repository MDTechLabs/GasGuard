## Summary

This pull request introduces a new optimization rule to detect and flag unnecessary storage writes in a contract's constructor. Redundant assignments to state variables during construction lead to wasted gas on deployment. This rule helps developers identify and eliminate these inefficiencies.

## What Changed

- **Added Rule:** Implemented `detect-unnecessary-constructor-storage-writes.ts` to identify when a state variable is assigned a value more than once within the constructor.
- **Added Tests:** Created corresponding unit tests with mock contracts (`UnnecessaryWritesContract.sol` and `NoUnnecessaryWritesContract.sol`) to validate the rule's accuracy and prevent false positives.

## Why

Unnecessary storage writes during deployment are an anti-pattern that increases gas costs without providing any functional benefit. This rule helps developers write more efficient and cost-effective contracts by flagging these redundant assignments.

## Testing Performed

- [x] Wrote unit tests for the new rule.
- [x] Manually verified the rule against several contracts.

## Edge Cases Considered

- Contracts with no constructor.
- Constructors with no storage writes.
- Constructors with multiple, non-redundant storage writes to different variables.

## Risks

None. This is a non-breaking, additive change that only introduces a new check.

Closes #356