// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GasGuardFactory
 * @notice Factory for deploying GasGuard router instances using custom errors in constructor.
 */
contract GasGuardFactory {
    error ZeroInit();
    error InvalidOwner();

    address public immutable owner;
    uint256 public immutable initialFee;

    constructor(address _owner, uint256 _initialFee) {
        if (_owner == address(0)) revert InvalidOwner();
        if (_initialFee == 0) revert ZeroInit();

        owner = _owner;
        initialFee = _initialFee;
    }
}
