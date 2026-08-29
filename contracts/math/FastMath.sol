// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FastMath
/// @notice Gas-optimized math utilities using bitwise operations.
/// @dev Replaces expensive arithmetic opcodes (MUL, DIV, MOD) with cheaper
///      bitwise opcodes (SHL, SHR, AND) when operating on powers of two.
library FastMath {
    /// @notice Multiply x by 2 using a left shift (saves 2 gas vs `x * 2`).
    function mul2(uint256 x) internal pure returns (uint256) {
        return x << 1;
    }

    /// @notice Divide x by 4 using a right shift (saves 2 gas vs `x / 4`).
    function div4(uint256 x) internal pure returns (uint256) {
        return x >> 2;
    }

    /// @notice Compute x modulo 8 using a bitwise AND (saves 2 gas vs `x % 8`).
    function mod8(uint256 x) internal pure returns (uint256) {
        return x & 7;
    }
}
