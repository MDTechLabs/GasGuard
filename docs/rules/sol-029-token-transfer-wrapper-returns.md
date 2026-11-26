# Non-standard Token Return Behavior in Transfer Wrappers (`sol-029`)

Detector: `libs/engine/analyzers/token-transfer-wrapper-detector.ts`
Tests: `libs/engine/analyzers/token-transfer-wrapper-detector.spec.ts`

## What it detects

Non-standard ERC20 token transfer behaviors and wrapper deficiencies:

1. `assumes-bool-return`: High-level `transfer` or `transferFrom` calls expecting a boolean return value. Tokens like USDT return no data, causing standard Solidity ABI decoding to revert.
2. `unchecked-boolean-return`: Ignoring return values of `transfer` or `transferFrom` where tokens returning `false` fail silently without reverting.
3. `decode-without-length-check`: Custom low-level transfer wrappers that call `abi.decode(data, (bool))` without checking `data.length > 0`, causing reverts on tokens with empty return data.
4. `unsafe-low-level-wrapper`: Low-level call wrappers that inspect `success` but ignore returned `bytes data`, treating explicit `false` results as success.

## Recognized as safe

- Using OpenZeppelin `SafeERC20.safeTransfer` and `SafeERC20.safeTransferFrom`.
- Low-level transfer wrappers validating: `require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed")`.

## Severity and rationale

Severity: HIGH.
Non-standard token handling either locks contract operations due to unexpected reverts (e.g. USDT) or enables theft and accounting desync by treating failed transfers as successful.
