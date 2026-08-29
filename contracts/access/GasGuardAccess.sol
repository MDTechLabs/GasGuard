// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract GasGuardAccess {
    address public owner;
    address public pendingOwner;

    error Unauthorized();
    error ZeroAddress();
    error AlreadySet();

    event OwnershipTransferStarted(address indexed from, address indexed to);

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    function _checkOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
