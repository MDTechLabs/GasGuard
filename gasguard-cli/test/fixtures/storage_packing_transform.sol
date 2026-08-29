// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title UnpackedVault
/// @notice Fixture contract used by `transformers::storage_packer` tests
/// and the `reorder-storage` CLI command's manual QA. State variables are
/// declared in an intentionally unpacked order (5 slots) that Rule G015
/// should compact down to 2 slots.
contract UnpackedVault {
    /// @notice Total value locked, tracked in wei.
    uint256 public totalValueLocked;
    /// @notice Whether deposits are currently paused.
    bool public paused;
    /// @notice The account authorized to pause/unpause the vault.
    address public guardian;
    /// @notice Fee tier applied to withdrawals, in basis points buckets.
    uint8 public feeTier;
    /// @notice Running count of unique depositors.
    uint256 public depositorCount;

    mapping(address => uint256) public balances;

    constructor(address guardian_) {
        guardian = guardian_;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        totalValueLocked += msg.value;
    }
}
