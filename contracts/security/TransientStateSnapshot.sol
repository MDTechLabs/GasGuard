// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TransientStateSnapshot
/// @notice EIP-1153 transient memory state rollback guard. Snapshots storage slots
///         into transient storage (TLOAD/TSTORE) and provides batch rollback.
/// @dev All gas-sensitive operations use Yul assembly. Transient storage is
///      automatically cleared at end of transaction (EIP-1153), so on revert the
///      EVM naturally discards transient data. Explicit rollback functions allow
///      selective partial rollbacks within multi-step logic.
abstract contract TransientStateSnapshot {
    error SnapshotOverflow();
    error SlotNotTracked();

    bytes32 private constant _COUNTER_SLOT = bytes32(uint256(0));
    bytes32 private constant _TRACKER_BASE = bytes32(uint256(1));
    bytes32 private constant _DOMAIN =
        0x2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c2e8c;
    bytes32 private constant _EXISTS =
        0xe81ce81ce81ce81ce81ce81ce81ce81ce81ce81ce81ce81ce81ce81ce81ce81c;

    /// @notice Records snapshots before execution; on success clears tracking.
    ///         On revert the EVM automatically discards transient state.
    modifier withRollback() {
        uint256 count = _snapshotAll();
        _;
        _clearTracking(count);
    }

    /// @notice Records the current value of a persistent storage slot into
    ///         transient storage and tracks it for batch rollback.
    /// @param slot The persistent storage slot to snapshot.
    function _snapshotSlot(bytes32 slot) internal virtual {
        bytes32 tkey;
        bytes32 ekey;
        bytes32 value;
        uint256 count;
        assembly {
            value := sload(slot)
            mstore(0x00, slot)
            mstore(0x20, _DOMAIN)
            tkey := keccak256(0x00, 0x40)
            mstore(0x20, _EXISTS)
            ekey := keccak256(0x00, 0x40)
            count := tload(_COUNTER_SLOT)
        }
        if (count == type(uint256).max) revert SnapshotOverflow();
        assembly {
            tstore(_COUNTER_SLOT, add(count, 1))
            tstore(add(_TRACKER_BASE, count), slot)
            tstore(tkey, value)
            tstore(ekey, 1)
        }
    }

    /// @notice Batch snapshots multiple storage slots.
    /// @param slots Array of persistent storage slots to snapshot.
    function _snapshotSlots(bytes32[] memory slots) internal virtual {
        uint256 len = slots.length;
        for (uint256 i = 0; i < len; i++) {
            _snapshotSlot(slots[i]);
        }
    }

    /// @notice Restores a single slot from its transient snapshot back to
    ///         persistent storage via SSTORE.
    /// @param slot The persistent storage slot to restore.
    function _rollbackSlot(bytes32 slot) internal virtual {
        bytes32 value;
        bytes32 tkey;
        bytes32 ekey;
        uint256 tracked;
        assembly {
            mstore(0x00, slot)
            mstore(0x20, _DOMAIN)
            tkey := keccak256(0x00, 0x40)
            mstore(0x20, _EXISTS)
            ekey := keccak256(0x00, 0x40)
            tracked := tload(ekey)
            value := tload(tkey)
        }
        if (tracked == 0) revert SlotNotTracked();
        assembly {
            sstore(slot, value)
        }
    }

    /// @notice Rolls back all tracked slots using the transient counter.
    function _rollbackAll() internal virtual {
        uint256 count;
        assembly {
            count := tload(_COUNTER_SLOT)
        }
        for (uint256 i = 0; i < count; i++) {
            bytes32 slot;
            assembly {
                slot := tload(add(_TRACKER_BASE, i))
            }
            _rollbackSlot(slot);
        }
    }

    /// @notice Clears transient tracking state on completion.
    /// @param trackedCount The number of slots that were tracked.
    function _clearTracking(uint256 trackedCount) internal virtual {
        for (uint256 i = 0; i < trackedCount; i++) {
            bytes32 slot;
            bytes32 tkey;
            bytes32 ekey;
            assembly {
                slot := tload(add(_TRACKER_BASE, i))
                mstore(0x00, slot)
                mstore(0x20, _DOMAIN)
                tkey := keccak256(0x00, 0x40)
                mstore(0x20, _EXISTS)
                ekey := keccak256(0x00, 0x40)
                tstore(tkey, 0)
                tstore(ekey, 0)
                tstore(add(_TRACKER_BASE, i), 0)
            }
        }
        assembly {
            tstore(_COUNTER_SLOT, 0)
        }
    }

    /// @dev Virtual hook. Override in implementing contracts to snapshot the
    ///      specific slots that should be protected by withRollback.
    /// @return count Number of slots snapshotted.
    function _snapshotAll() internal virtual returns (uint256 count);
}
