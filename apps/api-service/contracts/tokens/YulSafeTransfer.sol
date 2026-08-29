// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title YulSafeTransfer
/// @notice Gas-efficient ERC20 `transfer`/`transferFrom` forwarding that
///         tolerates non-standard tokens, implemented with raw Yul.
/// @dev Why this exists: the ERC20 standard says `transfer`/`transferFrom`
///      MUST return a `bool`, but several widely-used tokens (most famously
///      USDT on mainnet) don't return anything at all, and some
///      implementations return `false` instead of reverting on failure. A
///      plain Solidity call like `IERC20(token).transfer(to, amount)` either
///      reverts outright on non-standard tokens (ABI decoding expects a
///      `bool` that never arrives) or silently ignores a `false` return
///      value (if declared without a return type). This library builds the
///      calldata and inspects the raw returndata by hand so it can apply the
///      correct rule for each shape of response:
///        - call reverted                       -> bubble up the revert reason
///        - returndatasize == 0                 -> treat as success (USDT-style)
///        - returndatasize == 32, word != 0      -> success (standard compliant)
///        - returndatasize == 32, word == 0      -> revert TransferFailed()
///        - any other returndatasize             -> revert TransferFailed()
library YulSafeTransfer {
    /// @notice Thrown when a token call succeeds at the EVM level but its
    ///         return value indicates the transfer itself failed (returned
    ///         `false`), or when it returns an unexpected data length that
    ///         doesn't match either the "no return value" or "bool" shapes.
    error TransferFailed();

    /// @notice Calls `token.transfer(to, amount)` and enforces ERC20-success
    ///         semantics, tolerating tokens that don't return a bool.
    function safeTransfer(address token, address to, uint256 amount) internal {
        // See the note in YulMathLib: `.selector` can't be referenced
        // directly inside assembly, only through a variable.
        bytes4 transferFailedSelector = TransferFailed.selector;

        assembly {
            // Build `transfer(address,uint256)` calldata starting at the
            // free memory pointer. We never bump the pointer afterward
            // because this memory is only needed for the immediately
            // following `call` — nothing later in the calling function can
            // observe or depend on it, so reusing/overwriting it later is
            // harmless and cheaper than maintaining it as "allocated".
            let ptr := mload(0x40)

            // 0xa9059cbb == bytes4(keccak256("transfer(address,uint256)")).
            // `shl(224, selector)` places the 4-byte selector in the top 4
            // bytes of the 32-byte word (256 - 32 bits == 224-bit shift),
            // which is where calldata expects the function selector to
            // start (memory offsets are word-oriented, calldata is byte-
            // oriented, so shifting is how we bridge the two).
            mstore(ptr, shl(224, 0xa9059cbb))
            // `to` occupies calldata bytes [4:36). Writing a 32-byte word
            // starting at ptr+4 places it right after the 4-byte selector
            // that already occupies ptr's first 4 bytes; masking guards
            // against any dirty upper bits the `address` value might carry.
            mstore(add(ptr, 4), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            // `amount` occupies calldata bytes [36:68) — a plain full word.
            mstore(add(ptr, 36), amount)

            // Total calldata size: 4 (selector) + 32 (to) + 32 (amount) = 68.
            // We pass retSize = 0 because `returndatacopy`/`returndatasize`
            // below give us full access to the actual return data
            // regardless of what we reserve here.
            let callSuccess := call(gas(), token, 0, ptr, 68, 0, 0)

            if iszero(callSuccess) {
                // Bubble up the callee's revert reason verbatim: copy the
                // full returndata into memory and revert with exactly that.
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            let success := 0
            switch returndatasize()
            // Non-standard token (e.g. USDT) that returns nothing at all on
            // a successful transfer.
            case 0 {
                success := 1
            }
            // Standard-compliant token: a single word encoding a bool.
            case 32 {
                returndatacopy(0, 0, 32)
                success := iszero(iszero(mload(0)))
            }
            // `default` is implicit: any other returndatasize leaves
            // `success` at 0, which is rejected below.

            if iszero(success) {
                mstore(0x00, transferFailedSelector)
                revert(0x00, 0x04)
            }
        }
    }

    /// @notice Calls `token.transferFrom(from, to, amount)` and enforces
    ///         ERC20-success semantics, tolerating tokens that don't return
    ///         a bool.
    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        bytes4 transferFailedSelector = TransferFailed.selector;

        assembly {
            let ptr := mload(0x40)

            // 0x23b872dd == bytes4(keccak256("transferFrom(address,address,uint256)")).
            mstore(ptr, shl(224, 0x23b872dd))
            // `from` occupies calldata bytes [4:36).
            mstore(add(ptr, 4), and(from, 0xffffffffffffffffffffffffffffffffffffffff))
            // `to` occupies calldata bytes [36:68).
            mstore(add(ptr, 36), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            // `amount` occupies calldata bytes [68:100).
            mstore(add(ptr, 68), amount)

            // Total calldata size: 4 + 32 + 32 + 32 = 100.
            let callSuccess := call(gas(), token, 0, ptr, 100, 0, 0)

            if iszero(callSuccess) {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }

            let success := 0
            switch returndatasize()
            case 0 {
                success := 1
            }
            case 32 {
                returndatacopy(0, 0, 32)
                success := iszero(iszero(mload(0)))
            }

            if iszero(success) {
                mstore(0x00, transferFailedSelector)
                revert(0x00, 0x04)
            }
        }
    }
}
