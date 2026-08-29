// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title RevertingERC20
/// @notice Token whose `transfer`/`transferFrom` always revert with a known
///         reason string. Used to verify that `YulSafeTransfer` bubbles up
///         the callee's original revert reason instead of swallowing it or
///         reverting with its own generic error.
contract RevertingERC20 {
    string public constant REVERT_REASON = "RevertingERC20: transfer disabled";

    function transfer(address, uint256) external pure returns (bool) {
        revert(REVERT_REASON);
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert(REVERT_REASON);
    }
}
