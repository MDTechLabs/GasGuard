Closes #354

### Problem
Contracts that receive ETH or ERC-20 tokens—or that implement a pause/emergency mechanism—without any fund-recovery path risk permanently locking user funds if a critical bug is found, an admin key is lost, or the contract is paused indefinitely.

### Solution
Implemented a new rule at `rules/security/emergency/detect-missing-emergency-withdrawal.ts` that statically analyzes Solidity source and flags contracts that:

1. **Receive ETH** (`receive()`, `fallback()`, payable functions, `msg.value`) but expose no `withdraw`, `rescue`, `recover`, `emergencyExit`, `drain`, or `sweep` function and no `selfdestruct` call.
2. **Interact with ERC-20 tokens** (`IERC20`, `transferFrom`, `safeTransferFrom`, `.transfer(`, `.balanceOf(`) but expose no rescue/recovery function.
3. **Use a pause/emergency pattern** (`pause()`, `whenNotPaused`, `emergency`, `lockdown`) but provide no corresponding fund-recovery path.

Each violation includes:
- The **contract name** and **line number** of the `contract` declaration.
- A human-readable **reason** explaining the risk.
- An actionable **suggestion** with a ready-to-use code template for the appropriate emergency flow.

### Changes

| File | Description |
|---|---|
| `rules/security/emergency/detect-missing-emergency-withdrawal.ts` | New rule implementation |
| `tests/rules/detect-missing-emergency-withdrawal.spec.ts` | Comprehensive tests covering all violation kinds, clean contracts, multiple contracts, and line-number accuracy |

### Acceptance Criteria
- [x] Missing emergency withdrawals flagged (`eth-receiver-no-withdrawal`, `token-handler-no-withdrawal`, `pausable-no-withdrawal`)
- [x] Missing recovery methods detected
- [x] Emergency flow suggestions provided per violation kind
- [x] Clean contracts (with recovery methods or `selfdestruct`) are not flagged
- [x] Tests cover all scenarios
