# Rebasing-token balance assumptions in stored accounting (`GG-TOKEN-REBASE-001`)

Detector: `rules/security/tokens/detect-rebasing-balance-assumptions.ts` · Helper: `rules/security/tokens/token-calls.ts` · Tests: `rules/security/tokens/__tests__/detect-rebasing-balance-assumptions.spec.ts` · Analyzer rule: `sol-027` · Fixture: `tests/rules/fixtures/sol-027-rebasing-balance.sol` / `.json`

## What it detects

Contracts that persist a token quantity (`deposits[user] += amount`, `locked = token.balanceOf(address(this))`) and later pay it out (`token.transfer(to, amount)`) as if the contract's balance could only change through its own transfers. With a rebasing token the balance changes on its own: a negative rebase leaves the contract insolvent, a positive one strands the surplus. Returns the normalized `RuleResult` plus `tracked`: every stored variable with where it is stored and settled and its status (`stale-risk`, `share-based`, `excluded`, `unsettled`).

| `kind` | Meaning |
| --- | --- |
| `stale-stored-balance` | A stored token amount is later settled without share conversion or a live-balance calculation. `details.storedIn` / `settledIn` give function and line for each site. |

## Tracing

1. In each function, find token amounts pulled in with `transferFrom(..., address(this), amount)` and state variables written from that amount, from `token.balanceOf(address(this))`, or from a balance delta.
2. Find functions that pay out the same token (`transfer` / `safeTransfer`) with an amount tied to that variable, directly or through local variables and the checks/updates on the variable in the same function.

## Recognized as safe

- **Share-based designs:** variables named like shares/scaled balances, amounts converted with `convertToShares`, `getPooledEthByShares` and similar, and payouts computed from the live `balanceOf(address(this))`.
- **Explicit rebasing exclusions:** a comment `// gasguard-no-rebasing: <reason>`, `@custom:no-rebasing` or "rebasing tokens are not supported" in the contract; an on-chain guard such as `require(!isRebasing(token))`; the `nonRebasingTokens` option (token identifiers).

## Severity and confidence

High/high when the token name matches a known rebasing asset (stETH, aTokens, AMPL ...); high/medium when any token address can be supplied by the caller; medium/medium for a fixed token of unknown behavior; low/low for names that look non-rebasing (USDC, WETH ...) because the contract does not enforce it.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x, one source string; compiler settings are not read and no scripts or project configuration are executed.
- Token behavior is inferred from identifiers only; imported bases are not visible.
- Linking a payout to a stored variable is lexical (same function, shared parameter/local), so indirect flows through other contracts are missed.
- Malformed, empty or non-Solidity input returns `analyzed: false` with diagnostics.

## Fixtures

Vulnerable: `deposits[msg.sender] += amount;` in `deposit()` and `token.safeTransfer(msg.sender, amount)` in `withdraw()`.

Safe: store `shares` and pay `shares * token.balanceOf(address(this)) / totalShares`, or reject rebasing tokens explicitly. More cases are in the spec.

## Verification status

Tests were written but not run; no benchmark or independent review has been recorded.
