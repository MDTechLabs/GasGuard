// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PayloadDecoder
/// @notice Slices dynamic calldata payloads directly instead of copying sub-arrays to memory.
library PayloadDecoder {
    error SliceOutOfBounds();

    /// @notice Returns the `length` bytes of `payload` starting at `offset`, as a calldata view.
    function slice(bytes calldata payload, uint256 offset, uint256 length)
        internal
        pure
        returns (bytes calldata)
    {
        if (offset + length > payload.length) revert SliceOutOfBounds();
        return payload[offset:offset + length];
    }

    /// @notice Reads a big-endian uint32 length prefix at `offset` without copying to memory.
    function readLengthPrefix(bytes calldata payload, uint256 offset) internal pure returns (uint32 length) {
        bytes4 raw = bytes4(payload[offset:offset + 4]);
        length = uint32(raw);
    }
}
