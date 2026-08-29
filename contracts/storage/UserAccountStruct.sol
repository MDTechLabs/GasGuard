// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title UserAccountStruct
/// @notice Storage-optimized struct with fields packed into minimal EVM slots.
/// @dev Demonstrates optimal field ordering for EVM storage slot packing.
///      Fields are ordered by size descending to minimize padding waste.

/// @dev BEFORE (poorly packed - 4 slots):
/// struct UserAccountBad {
///     bool isActive;        // 1 byte  → slot 0 (wastes 31 bytes)
///     address wallet;       // 20 bytes → slot 1 (wastes 12 bytes)
///     uint256 balance;      // 32 bytes → slot 2 (full)
///     uint8 tier;           // 1 byte  → slot 3 (wastes 31 bytes)
///     uint64 lastActivity;  // 8 bytes → slot 4 (wastes 24 bytes)
///     uint32 loginCount;    // 4 bytes → slot 5 (wastes 28 bytes)
/// }

/// @dev AFTER (optimized - 3 slots):
/// struct UserAccountGood {
///     uint256 balance;      // 32 bytes → slot 0 (full)
///     address wallet;       // 20 bytes → slot 1, part 1
///     uint64 lastActivity;  // 8 bytes  → slot 1, part 2 (20+8=28 bytes, 4 padding)
///     uint32 loginCount;    // 4 bytes  → slot 1, part 3 (28+4=32 bytes, exact fit)
///     uint8 tier;           // 1 byte   → slot 2, part 1
///     bool isActive;        // 1 byte   → slot 2, part 2 (2 bytes, 30 padding)
/// }

contract UserAccountStruct {
    struct UserAccount {
        uint256 balance;      // slot 0: 32 bytes
        address wallet;       // slot 1: bytes 0-19 (20 bytes)
        uint64 lastActivity;  // slot 1: bytes 20-27 (8 bytes)
        uint32 loginCount;    // slot 1: bytes 28-31 (4 bytes)
        uint8 tier;           // slot 2: byte 0 (1 byte)
        bool isActive;        // slot 2: byte 1 (1 byte)
    }

    // Storage
    mapping(address => UserAccount) public accounts;
    uint256 public accountCount;

    // Packed admin info in a single slot
    // address (20) + uint64 (8) + uint32 (4) = 32 bytes exactly
    address public adminAddress;     // slot N: bytes 0-19
    uint64 public adminExpiry;       // slot N: bytes 20-27
    uint32 public adminNonce;        // slot N: bytes 28-31

    event AccountCreated(address indexed wallet, uint256 balance, uint8 tier);
    event AccountUpdated(address indexed wallet, uint64 lastActivity, uint32 loginCount);
    event AdminPacked(address admin, uint64 expiry, uint32 nonce);

    error ZeroAddress();
    error InvalidTier();
    error AccountNotFound();

    /// @notice Create a new user account with packed storage.
    /// @param wallet The user's wallet address.
    /// @param initialBalance Initial balance deposit.
    /// @param tier User tier level (0-255).
    function createAccount(
        address wallet,
        uint256 initialBalance,
        uint8 tier
    ) external {
        if (wallet == address(0)) revert ZeroAddress();
        if (tier > 10) revert InvalidTier();

        UserAccount storage acct = accounts[wallet];
        acct.balance = initialBalance;
        acct.wallet = wallet;
        acct.lastActivity = uint64(block.timestamp);
        acct.loginCount = 1;
        acct.tier = tier;
        acct.isActive = true;

        accountCount++;
        emit AccountCreated(wallet, initialBalance, tier);
    }

    /// @notice Update account activity timestamp and login count.
    /// @param wallet The user's wallet address.
    function recordActivity(address wallet) external {
        UserAccount storage acct = accounts[wallet];
        if (acct.wallet == address(0)) revert AccountNotFound();

        acct.lastActivity = uint64(block.timestamp);
        acct.loginCount++;

        emit AccountUpdated(wallet, acct.lastActivity, acct.loginCount);
    }

    /// @notice Set packed admin info in a single storage write.
    /// @param admin The admin address.
    /// @param expiry Expiry timestamp.
    /// @param nonce Current nonce.
    function setPackedAdmin(
        address admin,
        uint64 expiry,
        uint32 nonce
    ) external {
        adminAddress = admin;
        adminExpiry = expiry;
        adminNonce = nonce;

        emit AdminPacked(admin, expiry, nonce);
    }

    /// @notice Get full account data.
    function getAccount(address wallet) external view returns (UserAccount memory) {
        return accounts[wallet];
    }
}
