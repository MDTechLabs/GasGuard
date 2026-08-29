// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title NaiveBoolMapping
/// @notice Test-only baseline: the `mapping(uint256 => bool)` pattern that
///         `BitmapTracker` replaces. Every distinct key gets its own 32-byte
///         storage slot, so the first `set` for any given key always pays a
///         fresh-slot `SSTORE`. Used purely as a gas comparison baseline in
///         tests — not part of the `BitmapTracker` deliverable itself.
contract NaiveBoolMapping {
    mapping(uint256 => bool) public flags;

    function set(uint256 index) external {
        flags[index] = true;
    }
}
