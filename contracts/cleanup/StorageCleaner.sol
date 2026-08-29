// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title StorageCleaner
/// @notice Explicit storage slot zeroing for EIP-3529 gas refunds.
/// @dev Systematically clears unused storage slots after operations complete to claim
///      available gas refunds. Under EIP-3529, each cleared slot refunds 4,800 gas.
library StorageCleaner {
    /// @dev Zero out a single storage slot.
    function clearSlot(bytes32 slot) internal {
        assembly {
            sstore(slot, 0)
        }
    }

    /// @dev Zero out a uint256 storage slot.
    function clearUintSlot(bytes32 slot) internal {
        assembly {
            sstore(slot, 0)
        }
    }

    /// @dev Zero out an address storage slot.
    function clearAddrSlot(bytes32 slot) internal {
        assembly {
            sstore(slot, 0)
        }
    }

    /// @dev Zero out a range of consecutive storage slots.
    /// @param startSlot The first slot to clear.
    /// @param count Number of consecutive slots to clear.
    function clearSlotRange(bytes32 startSlot, uint256 count) internal {
        assembly {
            let slot := startSlot
            for { let i := 0 } i < count { i := add(i, 1) } {
                sstore(slot, 0)
                slot := add(slot, 1)
            }
        }
    }
}

/// @title StorageCleanerConsumer
/// @notice Example contract demonstrating explicit storage cleanup for gas refunds.
contract StorageCleanerConsumer {
    using StorageCleaner for bytes32;

    struct Request {
        address sender;
        uint256 amount;
        uint256 timestamp;
        bool completed;
    }

    // Storage
    mapping(uint256 => Request) public requests;
    uint256 public requestCount;
    uint256 public totalCleared;

    // Track which slots to clean
    mapping(uint256 => bool) public slotCleared;

    event RequestCreated(uint256 indexed id, address sender, uint256 amount);
    event RequestCompleted(uint256 indexed id, uint256 refundGas);
    event StorageCleared(uint256 indexed requestId, uint256 slotsCleared);

    error RequestNotFound();
    error RequestAlreadyCompleted();
    error ZeroAmount();

    /// @notice Create a new request, storing data in storage slots.
    function createRequest(uint256 amount) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();

        id = requestCount++;
        requests[id] = Request({
            sender: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            completed: false
        });

        emit RequestCreated(id, msg.sender, amount);
    }

    /// @notice Complete a request and explicitly clear its storage slots for gas refund.
    /// @param id The request ID to complete.
    function completeRequest(uint256 id) external {
        Request storage req = requests[id];
        if (req.sender == address(0)) revert RequestNotFound();
        if (req.completed) revert RequestAlreadyCompleted();

        // Mark as completed
        req.completed = true;

        // Explicitly zero out fields that are no longer needed
        // Each cleared slot provides ~4,800 gas refund under EIP-3529
        uint256 refundBefore = gasleft();

        // Clear the sender field (no longer needed after completion)
        bytes32 senderSlot = keccak256(abi.encode(id, uint256(0)));
        senderSlot.clearSlot();

        // Clear the timestamp field
        bytes32 timestampSlot = keccak256(abi.encode(id, uint256(2)));
        timestampSlot.clearSlot();

        uint256 refundAfter = gasleft();

        slotCleared[id] = true;
        totalCleared++;

        emit RequestCompleted(id, refundBefore - refundAfter);
        emit StorageCleared(id, 2);
    }

    /// @notice Batch complete requests and clear storage.
    /// @param ids Array of request IDs to complete.
    function batchComplete(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            if (requests[ids[i]].sender != address(0) && !requests[ids[i]].completed) {
                this.completeRequest(ids[i]);
            }
        }
    }

    /// @notice Read a request's data.
    function getRequest(uint256 id) external view returns (Request memory) {
        return requests[id];
    }
}
