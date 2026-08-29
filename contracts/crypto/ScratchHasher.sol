// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ScratchHasher
/// @notice Computes keccak256 hashes for two 32-byte words using EVM scratch space.
/// @dev Avoids abi.encodePacked() and free memory pointer expansion.
contract ScratchHasher {
    /// @notice Hash two 32-byte values.
    /// @param a First 32-byte word.
    /// @param b Second 32-byte word.
    /// @return result keccak256(abi.encodePacked(a, b))
    function hash(
        bytes32 a,
        bytes32 b
    ) external pure returns (bytes32 result) {
        assembly {
            // --------------------------------------------------------
            // Scratch Space Layout
            //
            // 0x00 - 0x1F : a
            // 0x20 - 0x3F : b
            //
            // Hash exactly 64 bytes.
            // --------------------------------------------------------

            mstore(0x00, a)
            mstore(0x20, b)

            result := keccak256(0x00, 0x40)
        }
    }

    /// @notice Compare the optimized hash with Solidity's implementation.
    function hashSolidity(
        bytes32 a,
        bytes32 b
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(a, b));
    }

    /// @notice Returns true if both implementations produce identical hashes.
    function verify(
        bytes32 a,
        bytes32 b
    ) external pure returns (bool) {
        bytes32 yulHash;
        bytes32 solidityHash = keccak256(abi.encodePacked(a, b));

        assembly {
            mstore(0x00, a)
            mstore(0x20, b)
            yulHash := keccak256(0x00, 0x40)
        }

        return yulHash == solidityHash;
    }
}