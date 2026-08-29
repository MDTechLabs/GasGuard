// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ZeroCopyRouter
/// @notice A low-level router that extracts calldata slices using Yul assembly
///         without allocating intermediate memory buffers.
/// @dev Uses `calldataload` and `calldatacopy` directly to pass payload pointers
///      to `delegatecall`. Payloads are copied to a safe memory region (0x80+)
///      to avoid overwriting the free memory pointer at 0x40.
contract ZeroCopyRouter {
    /// @notice Execute a batch of delegatecalls to target addresses with
    ///         packed calldata. Per-call layout: [address (20B)] [uint16 len]
    ///         [payload bytes ...]
    /// @param packedBatch ABI-encoded batch of targets + payloads.
    /// @return results Array of success bools, one per sub-call.
    function batchExecute(
        bytes calldata packedBatch
    ) external returns (bool[] memory results) {
        results = new bool[](16); // max batch size safety cap
        uint256 ptr;
        uint256 batchLen = packedBatch.length;
        uint256 count;

        assembly {
            let dataPtr := add(packedBatch.offset, 4)
            let dataEnd := add(dataPtr, batchLen)

            for {

            } lt(dataPtr, dataEnd) {

            } {
                // Load target address.
                let target := calldataload(dataPtr)
                // Load payload length (uint16, big-endian).
                let payloadLen := shr(
                    240,
                    calldataload(add(dataPtr, 20))
                )
                dataPtr := add(dataPtr, 22)

                // Copy payload to safe memory region (0x80 avoids 0x40 free ptr).
                let payloadStart := dataPtr
                calldatacopy(0x80, payloadStart, payloadLen)

                // delegatecall with the payload slice.
                let success := delegatecall(
                    gas(),
                    target,
                    0x80,
                    payloadLen,
                    0x80,
                    0x20
                )

                // Store result.
                mstore(
                    add(results, add(0x20, mul(count, 0x20))),
                    success
                )
                dataPtr := add(dataPtr, payloadLen)
                count := add(count, 1)
            }
        }

        // Trim results to actual count.
        assembly {
            mstore(results, count)
        }
    }
}
