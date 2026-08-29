// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title YulByteSwapper
 * @notice High-performance 256-bit endianness reversal utility.
 *
 * Reverses all 32 bytes of a bytes32/uint256 value using a fixed sequence
 * of bitwise operations in Yul.
 *
 * No loops.
 * No memory allocation.
 * O(1) execution complexity.
 */
library YulByteSwapper {
    /**
     * @notice Reverse the byte order of a 256-bit word.
     *
     * Example:
     *   0x0102030405060708091011121314151617181920212223242526272829303132
     *
     * becomes:
     *   0x3231302928272625242322212019181716151413121110090807060504030201
     *
     * @param value The 256-bit word to reverse.
     * @return result The byte-reversed 256-bit word.
     */
    function swap(bytes32 value) internal pure returns (bytes32 result) {
        assembly {
            let x := value

            // Swap adjacent bytes:
            // ABCD -> BADC
            x := or(
                and(shr(8, x), 0x00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF),
                and(shl(8, x), 0xFF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF00FF)
            )

            // Swap adjacent 2-byte groups:
            // BADC -> DCBA
            x := or(
                and(
                    shr(16, x),
                    0x0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF
                ),
                and(
                    shl(16, x),
                    0xFFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000FFFF0000
                )
            )

            // Swap adjacent 4-byte groups.
            x := or(
                and(
                    shr(32, x),
                    0x00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF
                ),
                and(
                    shl(32, x),
                    0xFFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000FFFFFFFF00000000
                )
            )

            // Swap adjacent 8-byte groups.
            x := or(
                and(
                    shr(64, x),
                    0x0000000000000000FFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF
                ),
                and(
                    shl(64, x),
                    0xFFFFFFFFFFFFFFFF0000000000000000FFFFFFFFFFFFFFFF0000000000000000
                )
            )

            // Swap the two 16-byte halves.
            result := or(shr(128, x), shl(128, x))
        }
    }

    /**
     * @notice Reverse the byte order of a uint256.
     * @param value The 256-bit word to reverse.
     * @return result The byte-reversed 256-bit word.
     */
    function swapUint256(uint256 value) internal pure returns (uint256 result) {
        result = uint256(swap(bytes32(value)));
    }
}