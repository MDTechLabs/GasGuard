// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulBitSlice
/// @notice Gas-optimized Yul assembly utility for extracting arbitrary
/// bit-length slices from unpadded `calldata`/`bytes` buffers without
/// allocating intermediate memory copies of the full buffer.
/// @dev Bit offsets are counted from the most-significant bit of the first
/// byte (big-endian, matching how `bytes` data is laid out on-chain).
library YulBitSlice {
    error BitLengthTooLarge(uint256 bitLength);
    error OutOfBounds(uint256 bitOffset, uint256 bitLength, uint256 dataLength);

    /// @notice Extracts `bitLength` bits starting at `bitOffset` (in bits)
    /// from `data`, returning them right-aligned in the low-order bits of
    /// the returned `uint256`.
    /// @param data The source calldata byte buffer.
    /// @param bitOffset The starting bit position (0-indexed from the MSB of byte 0).
    /// @param bitLength The number of bits to extract. Must be <= 256.
    /// @return result The extracted bits, right-aligned and zero-padded.
    function extractBits(bytes calldata data, uint256 bitOffset, uint256 bitLength)
        internal
        pure
        returns (uint256 result)
    {
        if (bitLength == 0 || bitLength > 256) revert BitLengthTooLarge(bitLength);
        uint256 dataBits = data.length * 8;
        if (bitOffset + bitLength > dataBits) {
            revert OutOfBounds(bitOffset, bitLength, data.length);
        }

        // Safety: reads only from calldata within [data.offset, data.offset + data.length);
        // no storage access, no external calls, no memory writes beyond scratch space.
        // Gas: two `calldataload`s (worst case, when the slice straddles a 32-byte
        // calldata word boundary) plus shifts/masks — no loops, no memory expansion.
        assembly {
            let byteOffset := shr(3, bitOffset)
            let bitShiftInByte := and(bitOffset, 7)

            // Load up to 32 bytes starting at the byte containing bitOffset.
            // calldataload reads 32 bytes past data.offset + byteOffset; calldata
            // past the actual buffer end reads as zero, which is safe here because
            // we've already bounds-checked bitOffset + bitLength above.
            let word := calldataload(add(data.offset, byteOffset))

            // Total bits available from bitShiftInByte to the end of `word`.
            // We want the `bitLength` bits starting at `bitShiftInByte` bits
            // into `word` (from the MSB side).
            let shiftFromRight := sub(256, add(bitShiftInByte, bitLength))

            switch slt(shiftFromRight, 0)
            case 0 {
                // The requested slice fits entirely within `word` from the MSB side.
                result := and(shr(shiftFromRight, word), sub(shl(bitLength, 1), 1))
            }
            default {
                // The slice straddles into the next calldata word; pull in the
                // next word and merge the two halves.
                let bitsFromFirstWord := sub(256, bitShiftInByte)
                let remainingBits := sub(bitLength, bitsFromFirstWord)

                let highPart := and(word, sub(shl(bitsFromFirstWord, 1), 1))

                let nextWord := calldataload(add(data.offset, add(byteOffset, 32)))
                let lowPart := shr(sub(256, remainingBits), nextWord)

                result := or(shl(remainingBits, highPart), lowPart)
            }
        }
    }

    /// @notice Extracts a byte-aligned sub-slice `[byteOffset, byteOffset + length)`
    /// from `data` and returns it as a new `bytes` value.
    /// @dev Thin convenience wrapper around `extractBits` for the common
    /// byte-aligned case; still avoids copying the *entire* source buffer.
    function sliceBytes(bytes calldata data, uint256 byteOffset, uint256 length)
        internal
        pure
        returns (bytes memory result)
    {
        if (byteOffset + length > data.length) {
            revert OutOfBounds(byteOffset * 8, length * 8, data.length);
        }
        result = data[byteOffset:byteOffset + length];
    }
}
