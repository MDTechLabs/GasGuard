// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title FalseReturningERC20
/// @notice Token whose `transfer`/`transferFrom` always return `false`
///         instead of reverting on failure. Used to verify that
///         `YulSafeTransfer` treats a literal `false` return as a failure
///         and reverts with `TransferFailed()`, rather than silently
///         accepting it the way a naive `IERC20.transfer(...)` call
///         (without checking the return value) would.
contract FalseReturningERC20 {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
