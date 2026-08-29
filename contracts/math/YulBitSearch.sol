// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulBitSearch
/// @notice Constant-time bit index helpers for uint256 words.
/// @dev Both searches use eight binary-search stages, so their execution cost
///      does not depend on the position of the set bit.
library YulBitSearch {
    /// @notice Returns the index of the highest set bit in `value`.
    /// @dev Returns 0 when `value` is zero. Bit indexes are zero-based.
    function mostSignificantBit(uint256 value) internal pure returns (uint256 result) {
        assembly {
            if value {
                let shift := 0

                if gt(value, 0xffffffffffffffffffffffffffffffff) {
                    value := shr(128, value)
                    shift := add(shift, 128)
                }
                if gt(value, 0xffffffffffffffff) {
                    value := shr(64, value)
                    shift := add(shift, 64)
                }
                if gt(value, 0xffffffff) {
                    value := shr(32, value)
                    shift := add(shift, 32)
                }
                if gt(value, 0xffff) {
                    value := shr(16, value)
                    shift := add(shift, 16)
                }
                if gt(value, 0xff) {
                    value := shr(8, value)
                    shift := add(shift, 8)
                }
                if gt(value, 0xf) {
                    value := shr(4, value)
                    shift := add(shift, 4)
                }
                if gt(value, 3) {
                    value := shr(2, value)
                    shift := add(shift, 2)
                }
                if gt(value, 1) {
                    shift := add(shift, 1)
                }

                result := shift
            }
        }
    }

    /// @notice Returns the index of the lowest set bit in `value`.
    /// @dev Returns 0 when `value` is zero. Bit indexes are zero-based.
    function leastSignificantBit(uint256 value) internal pure returns (uint256 result) {
        assembly {
            if value {
                let shift := 0

                if iszero(and(value, 0xffffffffffffffffffffffffffffffff)) {
                    value := shr(128, value)
                    shift := add(shift, 128)
                }
                if iszero(and(value, 0xffffffffffffffff)) {
                    value := shr(64, value)
                    shift := add(shift, 64)
                }
                if iszero(and(value, 0xffffffff)) {
                    value := shr(32, value)
                    shift := add(shift, 32)
                }
                if iszero(and(value, 0xffff)) {
                    value := shr(16, value)
                    shift := add(shift, 16)
                }
                if iszero(and(value, 0xff)) {
                    value := shr(8, value)
                    shift := add(shift, 8)
                }
                if iszero(and(value, 0xf)) {
                    value := shr(4, value)
                    shift := add(shift, 4)
                }
                if iszero(and(value, 3)) {
                    value := shr(2, value)
                    shift := add(shift, 2)
                }
                if iszero(and(value, 1)) {
                    shift := add(shift, 1)
                }

                result := shift
            }
        }
    }
}