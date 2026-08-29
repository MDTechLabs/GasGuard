// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulSHA256
/// @notice Gas-efficient SHA2-256 hashing directly from calldata with zero-memory allocation.
library YulSHA256 {
    /**
     * @notice Computes the SHA2-256 hash of a calldata bytes array.
     * @dev Copies the calldata directly to the free memory pointer temporary space
     *      without updating the free memory pointer at 0x40.
     *      The precompile output is written directly to scratch space 0x00 to avoid allocation.
     * @param data The calldata bytes to hash.
     * @return digest The resulting SHA2-256 hash.
     */
    function hash(bytes calldata data) internal view returns (bytes32 digest) {
        assembly {
            // Load the free memory pointer
            let ptr := mload(0x40)

            // Copy calldata payload to the free memory pointer
            calldatacopy(ptr, data.offset, data.length)

            // Invoke SHA2-256 precompile (address 0x02)
            // Input: memory offset 'ptr', size 'data.length'
            // Output: directly to scratch space 0x00, size 0x20
            let success := staticcall(gas(), 0x02, ptr, data.length, 0x00, 0x20)

            // Revert if staticcall failed
            if iszero(success) {
                revert(0, 0)
            }

            // Load the digest from scratch space 0x00
            digest := mload(0x00)
        }
    }
}
