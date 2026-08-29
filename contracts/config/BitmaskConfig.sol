// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BitmaskConfig
/// @notice Compresses multiple boolean configuration flags into a single bytes32
///         storage slot, eliminating redundant SLOAD operations.
/// @dev Uses inline Yul assembly for bitwise get/set to avoid Solidity's
///      stack-heavy boolean encoding. Each flag occupies one bit.
contract BitmaskConfig {
    error Unauthorized();
    error InvalidBitOffset();

    address public immutable owner;

    // ─── Bit Offset Constants ───────────────────────────────────────────

    uint256 public constant PAUSED_BIT        = 1 << 0;
    uint256 public constant LOCKED_BIT        = 1 << 1;
    uint256 public constant ALLOW_PUBLIC_BIT  = 1 << 2;
    uint256 public constant FEE_SWITCH_BIT    = 1 << 3;
    uint256 public constant EMERGENCY_STOP_BIT = 1 << 4;
    uint256 public constant UPGRADEABLE_BIT   = 1 << 5;

    /// @dev Convenience alias for PR compatibility.
    uint256 private constant PUBLIC_BIT   = ALLOW_PUBLIC_BIT;
    uint256 private constant MIGRATED_BIT = FEE_SWITCH_BIT;

    /// @dev Single storage slot holding all configuration flags as a bitmask.
    bytes32 private _flags;

    // ─── Events ─────────────────────────────────────────────────────────

    event ConfigUpdated(bytes32 oldFlags, bytes32 newFlags);
    event FlagSet(uint256 indexed bit, bool value);
    event FlagToggled(uint256 indexed bit);

    // ─── Modifiers ──────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────

    /// @dev Deployer becomes the owner. All flags start as false.
    constructor() {
        owner = msg.sender;
    }

    // ─── Convenience Getters (PR style) ─────────────────────────────────

    function isPaused() external view returns (bool) {
        return _getFlag(PAUSED_BIT);
    }

    function isLocked() external view returns (bool) {
        return _getFlag(LOCKED_BIT);
    }

    function isPublic() external view returns (bool) {
        return _getFlag(PUBLIC_BIT);
    }

    function isMigrated() external view returns (bool) {
        return _getFlag(MIGRATED_BIT);
    }

    /// @dev Return the raw bytes32 bitmask.
    function getRawConfig() external view returns (bytes32) {
        return _flags;
    }

    // ─── Convenience Setters (PR style, owner-restricted) ───────────────

    function setPaused(bool value) external onlyOwner {
        _setFlag(PAUSED_BIT, value);
    }

    function setLocked(bool value) external onlyOwner {
        _setFlag(LOCKED_BIT, value);
    }

    function setPublic(bool value) external onlyOwner {
        _setFlag(PUBLIC_BIT, value);
    }

    function setMigrated(bool value) external onlyOwner {
        _setFlag(MIGRATED_BIT, value);
    }

    // ─── Generic Methods (main style) ───────────────────────────────────

    /// @dev Check if a specific bit is set.
    function isSet(uint256 bit) external view returns (bool) {
        uint256 result;
        assembly {
            let f := sload(_flags.slot)
            result := and(f, bit)
        }
        return result != 0;
    }

    /// @dev Set or clear a specific bit (owner only).
    function setFlag(uint256 bit, bool value) external onlyOwner {
        if (bit > UPGRADEABLE_BIT) revert InvalidBitOffset();
        assembly {
            let f := sload(_flags.slot)
            switch value
            case 1 { f := or(f, bit) }
            default { f := and(f, not(bit)) }
            sstore(_flags.slot, f)
        }
        emit FlagSet(bit, value);
    }

    /// @dev Toggle a specific bit (owner only).
    function toggleFlag(uint256 bit) external onlyOwner {
        if (bit > UPGRADEABLE_BIT) revert InvalidBitOffset();
        assembly {
            let f := sload(_flags.slot)
            f := xor(f, bit)
            sstore(_flags.slot, f)
        }
        emit FlagToggled(bit);
    }

    /// @dev Return all six flags as an array.
    function getFlags() external view returns (bool[6] memory) {
        bytes32 f = _flags;
        bool[6] memory result;
        result[0] = (f & bytes32(PAUSED_BIT)) != 0;
        result[1] = (f & bytes32(LOCKED_BIT)) != 0;
        result[2] = (f & bytes32(ALLOW_PUBLIC_BIT)) != 0;
        result[3] = (f & bytes32(FEE_SWITCH_BIT)) != 0;
        result[4] = (f & bytes32(EMERGENCY_STOP_BIT)) != 0;
        result[5] = (f & bytes32(UPGRADEABLE_BIT)) != 0;
        return result;
    }

    // ─── Internal Bitwise Operations ────────────────────────────────────

    /// @dev Get a single bit flag using inline assembly.
    function _getFlag(uint256 bit) private view returns (bool flag) {
        assembly {
            flag := and(sload(_flags.slot), bit)
        }
    }

    /// @dev Set or clear a single bit flag using inline assembly.
    function _setFlag(uint256 bit, bool value) private {
        bytes32 oldFlags;
        bytes32 newFlags;

        assembly {
            let slot := _flags.slot
            oldFlags := sload(slot)

            if value {
                newFlags := or(oldFlags, bit)
            }
            if iszero(value) {
                newFlags := and(oldFlags, not(bit))
            }
            sstore(slot, newFlags)
        }

        emit ConfigUpdated(oldFlags, newFlags);
    }
}
