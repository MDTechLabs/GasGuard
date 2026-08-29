// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title YulBytesUtils
/// @notice Gas-efficient byte array concatenation using inline assembly.
library YulBytesUtils {
    function bytesConcat(
        bytes calldata a,
        bytes calldata b
    ) internal pure returns (bytes memory result) {
        assembly {
            // Load free memory pointer
            let ptr := mload(0x40)

            // Lengths
            let lenA := a.length
            let lenB := b.length
            let totalLen := add(lenA, lenB)

            // Store total length
            mstore(ptr, totalLen)

            // Destination pointer
            let dest := add(ptr, 0x20)

            // Copy first array
            calldatacopy(
                dest,
                a.offset,
                lenA
            )

            // Copy second array
            calldatacopy(
                add(dest, lenA),
                b.offset,
                lenB
            )

            // Round memory allocation to next 32-byte word
            let rounded := and(
                add(add(totalLen, 0x20), 31),
                not(31)
            )

            // Update free memory pointer
            mstore(0x40, add(ptr, rounded))

            result := ptr
        }
    }
}