# Fee-on-transfer assumptions (`GG-TOKEN-FEE-001`)

Detector: `rules/security/tokens/detect-fee-on-transfer-assumptions.ts` · Helper: `rules/security/tokens/token-calls.ts` · Tests: `rules/security/tokens/__tests__/detect-fee-on-transfer-assumptions.spec.ts`

## What it detects

Code that treats the amount passed to `transferFrom` / `safeTransferFrom(from, address(this), amount)` as the amount the contract received. Fee-on-transfer, deflationary and hook-taxing tokens deliver less. The amount is followed through local assignments to what the function does next. Returns the normalized `RuleResult` plus `inflows` (every inflow with token, amount and status `measured` / `excluded` / `unused` / `flagged`).

| `kind` | Meaning | Severity |
| --- | --- | --- |
| `credited-requested-amount` | The requested amount is written to state or minted without measuring what arrived. High for a per-account entry (`deposits[user] += amount`) or `_mint`; medium for an aggregate counter. | high / medium |
| `forwarded-requested-amount` | The requested amount is forwarded to another call (`transfer`, `deposit`, `swap*`, `addLiquidity*`, `stake`, `supply`); the call reverts or pays from pooled funds. | low |

Confidence is `medium` for unknown or caller-supplied tokens and `low` for well-known fixed tokens (usdc, weth, ...), because the token's behavior is not visible.

## Accepted patterns

- The balance of the contract for the same token is read at least twice in the function (balance-before / balance-after). Whether the delta is computed correctly is reported by `GG-TOKEN-DELTA-001`.
- An explicit exclusion in or just above the contract: `@custom:no-fee-on-transfer`, `gasguard-no-fot`, or a comment such as "fee-on-transfer tokens are not supported".
- Debits (`-=`) after the inflow are not credits and are ignored.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x, one source string; the token's code is not visible. Library-style `SafeERC20.safeTransferFrom(token, from, to, amount)` calls are not recognized.
- Amounts are followed through local assignments in the same function only, not through helper functions.
- Malformed, empty, oversized or non-Solidity input returns `analyzed: false` with diagnostics; no project scripts or configuration are executed.
- False positives: a contract that allow-lists its tokens (so none can charge fees) should say so with the exclusion comment.

## Fixtures

Vulnerable: `token.safeTransferFrom(msg.sender, address(this), amount); deposits[msg.sender] += amount;`
Safe: read `token.balanceOf(address(this))` before and after the transfer and credit the difference. More cases are in the spec.
