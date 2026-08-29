// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CompressedLogger
/// @notice Packs timestamp/categoryId/amount into one bytes32 word instead of
///         three un-indexed event params (user stays indexed for filtering).
library CompressedLogger {
    event PackedOperation(address indexed user, bytes32 packed);

    /// @dev Layout (high to low bits): timestamp(64) | categoryId(32) | amount(64).
    function pack(uint64 timestamp, uint32 categoryId, uint64 amount) internal pure returns (bytes32 packed) {
        packed = bytes32(
            (uint256(timestamp) << 96) | (uint256(categoryId) << 64) | uint256(amount)
        );
    }

    function emitPacked(address user, uint64 timestamp, uint32 categoryId, uint64 amount) internal {
        emit PackedOperation(user, pack(timestamp, categoryId, amount));
    }
}
