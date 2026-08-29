// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DenseMap
/// @notice Stores up to 32 uint8 values inside a single storage slot.
/// @dev Replaces mapping(uint8 => uint8) with bit-packed storage.
contract DenseMap {
    /// @dev One storage slot holding 32 packed uint8 values.
    bytes32 private packedData;

    error IndexOutOfBounds();

    /// @notice Stores a uint8 value at the specified index.
    /// @param index Position (0-31).
    /// @param value Value to store.
    function set(uint8 index, uint8 value) external {
        if (index >= 32) revert IndexOutOfBounds();

        uint256 word = uint256(packedData);

        unchecked {
            uint256 shift = uint256(index) * 8;

            // Clear existing byte
            word &= ~(uint256(0xff) << shift);

            // Insert new byte
            word |= uint256(value) << shift;
        }

        packedData = bytes32(word);
    }

    /// @notice Reads the value stored at an index.
    /// @param index Position (0-31).
    function get(uint8 index) external view returns (uint8 value) {
        if (index >= 32) revert IndexOutOfBounds();

        unchecked {
            uint256 shift = uint256(index) * 8;

            value = uint8(
                (uint256(packedData) >> shift) &
                    0xff
            );
        }
    }

    /// @notice Reads the entire packed storage word.
    function packedWord() external view returns (bytes32) {
        return packedData;
    }

    /// @notice Clears all stored values.
    function clear() external {
        packedData = bytes32(0);
    }

    /// @notice Batch writes multiple values.
    function setMany(
        uint8[] calldata indexes,
        uint8[] calldata values
    ) external {
        require(indexes.length == values.length, "Length mismatch");

        uint256 word = uint256(packedData);

        for (uint256 i; i < indexes.length; ) {
            uint8 index = indexes[i];

            if (index >= 32) revert IndexOutOfBounds();

            uint256 shift = uint256(index) * 8;

            word &= ~(uint256(0xff) << shift);
            word |= uint256(values[i]) << shift;

            unchecked {
                ++i;
            }
        }

        packedData = bytes32(word);
    }

    /// @notice Batch reads multiple values.
    function getMany(
        uint8[] calldata indexes
    ) external view returns (uint8[] memory result) {
        result = new uint8[](indexes.length);

        uint256 word = uint256(packedData);

        for (uint256 i; i < indexes.length; ) {
            uint8 index = indexes[i];

            if (index >= 32) revert IndexOutOfBounds();

            uint256 shift = uint256(index) * 8;

            result[i] = uint8(
                (word >> shift) &
                    0xff
            );

            unchecked {
                ++i;
            }
        }
    }
}