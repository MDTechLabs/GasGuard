// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BitmaskApprovalTracker
/// @notice Multi-owner approval tracker packing up to 256 owner approval flags
///         into a single `bytes32` storage slot via Yul bitwise ops (SC-752).
/// @dev Owner indices map to bit positions 0–255. Toggling uses XOR; checks use AND.
contract BitmaskApprovalTracker {
    error IndexOutOfBounds();
    error Unauthorized();

    /// @dev Packed approval bitmask — one bit per owner index (0 = not approved, 1 = approved).
    bytes32 private _approvals;

    /// @dev Optional admin for privileged resets; deployer by default.
    address public admin;

    event ApprovalSet(uint8 indexed index, bool approved);
    event ApprovalToggled(uint8 indexed index, bool newState);
    event ApprovalsCleared();

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Returns whether owner index `index` (0–255) is approved.
    function isApproved(uint8 index) public view returns (bool approved) {
        bytes32 slot = _approvals;
        assembly {
            // mask = 1 << index
            let mask := shl(index, 1)
            approved := iszero(iszero(and(slot, mask)))
        }
    }

    /// @notice Raw packed approval state (single storage slot).
    function getApprovalsRaw() external view returns (bytes32) {
        return _approvals;
    }

    /// @notice Count of set approval bits (linear scan in Yul, view-only).
    function approvalCount() external view returns (uint256 count) {
        bytes32 slot = _approvals;
        assembly {
            // Kernighan's bit-count loop
            for {

            } slot {

            } {
                count := add(count, 1)
                slot := and(slot, sub(slot, 1))
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Mutations (Yul AND / OR / XOR)
    // ─────────────────────────────────────────────────────────────────────

    /// @notice Set approval for `index` to `approved` (idempotent).
    function setApproval(uint8 index, bool approved) external onlyAdmin {
        bytes32 slot = _approvals;
        assembly {
            let mask := shl(index, 1)
            switch approved
            case 0 {
                // clear bit: slot & ~mask
                slot := and(slot, not(mask))
            }
            default {
                // set bit: slot | mask
                slot := or(slot, mask)
            }
            sstore(_approvals.slot, slot)
        }
        emit ApprovalSet(index, approved);
    }

    /// @notice Flip approval bit for `index` using XOR.
    function toggleApproval(uint8 index) external onlyAdmin returns (bool newState) {
        bytes32 slot = _approvals;
        assembly {
            let mask := shl(index, 1)
            slot := xor(slot, mask)
            sstore(_approvals.slot, slot)
            newState := iszero(iszero(and(slot, mask)))
        }
        emit ApprovalToggled(index, newState);
    }

    /// @notice Batch-set approvals for indices in `indices` to `approved`.
    function setApprovalsBatch(uint8[] calldata indices, bool approved) external onlyAdmin {
        uint256 len = indices.length;
        bytes32 slot = _approvals;
        assembly {
            let data := indices.offset
            for {
                let i := 0
            } lt(i, len) {
                i := add(i, 1)
            } {
                let idx := calldataload(add(data, mul(i, 0x20)))
                // uint8 is left-padded in calldata word; take low byte
                idx := and(idx, 0xff)
                let mask := shl(idx, 1)
                switch approved
                case 0 {
                    slot := and(slot, not(mask))
                }
                default {
                    slot := or(slot, mask)
                }
            }
            sstore(_approvals.slot, slot)
        }
        for (uint256 i = 0; i < len; i++) {
            emit ApprovalSet(indices[i], approved);
        }
    }

    /// @notice Clear all 256 approval bits in one SSTORE.
    function clearAll() external onlyAdmin {
        assembly {
            sstore(_approvals.slot, 0)
        }
        emit ApprovalsCleared();
    }

    /// @notice True if at least `threshold` distinct indices are approved.
    function hasQuorum(uint8 threshold) external view returns (bool) {
        uint256 count;
        bytes32 slot = _approvals;
        assembly {
            for {

            } slot {

            } {
                count := add(count, 1)
                slot := and(slot, sub(slot, 1))
            }
        }
        return count >= threshold;
    }
}
