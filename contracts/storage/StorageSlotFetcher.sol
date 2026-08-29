// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title StorageSlotFetcher
/// @notice Batches reads from arbitrary storage slots into one dynamic array in a single call.
library StorageSlotFetcher {
    /// @notice Reads `slots.length` storage words and returns them in order.
    /// @dev Uses Yul `sload` in a loop instead of one external call per slot.
    function fetchSlots(bytes32[] calldata slots) internal view returns (bytes32[] memory values) {
        uint256 len = slots.length;
        values = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            bytes32 slot = slots[i];
            bytes32 value;
            assembly {
                value := sload(slot)
            }
            values[i] = value;
        }
    }
}
