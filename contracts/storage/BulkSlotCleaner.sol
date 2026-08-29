// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BulkSlotCleaner
/// @notice Clears contiguous storage slots in a single Yul assembly loop to
/// maximize EIP-3529 refund credits after cleanup work.
library BulkSlotCleaner {
    /// @notice Zeroes a contiguous range of storage slots starting at
    /// `startSlotKey` with `slotCount` entries.
    /// @dev The loop is intentionally implemented in Yul so the EVM performs a
    /// compact, opcode-level sweep without extra Solidity-level overhead.
    /// @param startSlotKey The first storage slot to clear.
    /// @param slotCount How many consecutive slots to clear.
    function clearRange(uint256 startSlotKey, uint256 slotCount) internal {
        assembly {
            let slot := startSlotKey
            let i := 0

            for { } lt(i, slotCount) { i := add(i, 1) } {
                sstore(slot, 0)
                slot := add(slot, 1)
            }
        }
    }
}

/// @title BulkSlotCleanerHarness
/// @notice Minimal wrapper used by tests to exercise the Yul-based cleaner.
contract BulkSlotCleanerHarness {
    using BulkSlotCleaner for uint256;

    function seedRange(uint256 startSlotKey, uint256 slotCount) external {
        assembly {
            let slot := startSlotKey
            let i := 0

            for { } lt(i, slotCount) { i := add(i, 1) } {
                sstore(slot, add(i, 1))
                slot := add(slot, 1)
            }
        }
    }

    function clearRange(uint256 startSlotKey, uint256 slotCount) external {
        startSlotKey.clearRange(slotCount);
    }

    function getValue(uint256 slotKey) external view returns (uint256 value) {
        assembly {
            value := sload(slotKey)
        }
    }
}
