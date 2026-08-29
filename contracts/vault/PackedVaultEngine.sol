// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PackedVaultEngine
/// @notice Multi-asset vault accounting engine that packs a user's balance,
/// asset id, and lock timestamp for a given position into a single
/// `bytes32` storage word, using inline Yul bit-masking/shifts to update
/// individual fields without disturbing the others.
/// @dev Bit layout of a packed position word (bit 0 = least significant):
///   [0, 128)   balance        (uint128)
///   [128, 160) assetId        (uint32)
///   [160, 224) lockTimestamp  (uint64, unix seconds)
///   [224, 256) unused/reserved
/// Managing these as three separate storage slots (as a Solidity struct
/// with three fields normally would) costs a `SLOAD`/`SSTORE` per field per
/// access; packing them into one word means every position read/write is
/// exactly one `SLOAD`/`SSTORE`, regardless of how many of the three
/// logical fields are touched.
///
/// Arithmetic itself (the `+`/`-` on `balance`) is done in plain, checked
/// Solidity `uint128` math — which reverts on overflow/underflow exactly
/// like any other Solidity arithmetic — and only the *field replacement*
/// (splicing the new balance into the existing word without touching the
/// assetId/lockTimestamp bits) is done via Yul mask/shift. Reimplementing
/// overflow-checked addition by hand in assembly would be strictly riskier
/// than using the compiler's own checked arithmetic for that part.
contract PackedVaultEngine {
    error PositionLocked(uint64 lockTimestamp, uint64 currentTimestamp);
    error InsufficientBalance(uint128 balance, uint128 requested);
    error ZeroAmount();

    uint256 private constant _BALANCE_MASK = (uint256(1) << 128) - 1;
    uint256 private constant _ASSET_ID_SHIFT = 128;
    uint256 private constant _ASSET_ID_MASK = (uint256(type(uint32).max)) << _ASSET_ID_SHIFT;
    uint256 private constant _LOCK_TIMESTAMP_SHIFT = 160;
    uint256 private constant _LOCK_TIMESTAMP_MASK = (uint256(type(uint64).max)) << _LOCK_TIMESTAMP_SHIFT;

    /// @dev positions[user][assetId] => packed(balance, assetId, lockTimestamp)
    mapping(address => mapping(uint32 => bytes32)) private _positions;

    event Deposited(address indexed user, uint32 indexed assetId, uint128 amount, uint128 newBalance, uint64 lockTimestamp);
    event Withdrawn(address indexed user, uint32 indexed assetId, uint128 amount, uint128 newBalance);

    /// @notice Deposits `amount` of `assetId` for `msg.sender`, extending
    /// the position's lock to `block.timestamp + lockDuration`.
    /// @param assetId The asset identifier for this position.
    /// @param amount The amount to add to the position's balance.
    /// @param lockDuration Seconds from now the position becomes withdrawable.
    function deposit(uint32 assetId, uint128 amount, uint64 lockDuration) external {
        if (amount == 0) revert ZeroAmount();

        bytes32 word = _positions[msg.sender][assetId];
        uint128 currentBalance = uint128(uint256(word) & _BALANCE_MASK);
        // Checked uint128 addition — reverts on overflow, matching what a
        // normal (unpacked) Solidity uint128 field would do.
        uint128 newBalance = currentBalance + amount;
        uint64 lockTimestamp = uint64(block.timestamp) + lockDuration;

        bytes32 newWord = _pack(newBalance, assetId, lockTimestamp);
        _positions[msg.sender][assetId] = newWord;

        emit Deposited(msg.sender, assetId, amount, newBalance, lockTimestamp);
    }

    /// @notice Withdraws `amount` of `assetId` from `msg.sender`'s position.
    /// Reverts if the position is still locked or the balance is insufficient.
    /// @param assetId The asset identifier for this position.
    /// @param amount The amount to subtract from the position's balance.
    function withdraw(uint32 assetId, uint128 amount) external {
        if (amount == 0) revert ZeroAmount();

        bytes32 word = _positions[msg.sender][assetId];
        uint128 currentBalance = uint128(uint256(word) & _BALANCE_MASK);
        uint64 lockTimestamp = uint64((uint256(word) & _LOCK_TIMESTAMP_MASK) >> _LOCK_TIMESTAMP_SHIFT);

        if (block.timestamp < lockTimestamp) {
            revert PositionLocked(lockTimestamp, uint64(block.timestamp));
        }
        if (amount > currentBalance) {
            revert InsufficientBalance(currentBalance, amount);
        }

        // Checked uint128 subtraction — reverts on underflow (already
        // guarded above, but kept for defense-in-depth / clarity).
        uint128 newBalance = currentBalance - amount;

        bytes32 newWord = _pack(newBalance, assetId, lockTimestamp);
        _positions[msg.sender][assetId] = newWord;

        emit Withdrawn(msg.sender, assetId, amount, newBalance);
    }

    /// @notice Returns the unpacked fields of `user`'s position in `assetId`.
    function getPosition(address user, uint32 assetId)
        external
        view
        returns (uint128 balance, uint32 storedAssetId, uint64 lockTimestamp)
    {
        bytes32 word = _positions[user][assetId];
        (balance, storedAssetId, lockTimestamp) = _unpack(word);
    }

    /// @dev Packs `(balance, assetId, lockTimestamp)` into a single word.
    /// Safety: pure bit arithmetic on function arguments already narrowed
    /// to their field widths by the Solidity type system (uint128/uint32/
    /// uint64) — no unmasked write can bleed into an adjacent field's bits.
    function _pack(uint128 bal, uint32 assetId, uint64 lockTimestamp)
        private
        pure
        returns (bytes32 word)
    {
        uint256 balanceMask = _BALANCE_MASK;
        uint256 assetIdField = uint256(assetId);
        uint256 lockTimestampField = uint256(lockTimestamp);
        assembly {
            word := or(
                and(bal, balanceMask),
                or(
                    shl(_ASSET_ID_SHIFT, and(assetIdField, 0xffffffff)),
                    shl(_LOCK_TIMESTAMP_SHIFT, and(lockTimestampField, 0xffffffffffffffff))
                )
            )
        }
    }

    /// @dev Unpacks a word into `(balance, assetId, lockTimestamp)`.
    /// Safety: masks isolate each field's bit range before shifting, so a
    /// value in one field can never leak into another field's return value.
    function _unpack(bytes32 word)
        private
        pure
        returns (uint128 bal, uint32 assetId, uint64 lockTimestamp)
    {
        uint256 balanceMask = _BALANCE_MASK;
        uint256 assetIdMask = _ASSET_ID_MASK;
        uint256 lockTimestampMask = _LOCK_TIMESTAMP_MASK;
        assembly {
            bal := and(word, balanceMask)
            assetId := shr(_ASSET_ID_SHIFT, and(word, assetIdMask))
            lockTimestamp := shr(_LOCK_TIMESTAMP_SHIFT, and(word, lockTimestampMask))
        }
    }
}
