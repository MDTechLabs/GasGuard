// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FastModMath
/// @notice Gas-optimized modular arithmetic using native EVM Yul assembly opcodes.
/// @dev Bypasses Solidity's overflow safety checks by using `mulmod` and `addmod`
///      opcodes directly, which compute modular results natively in the EVM.
library FastModMath {
    /// @notice Compute (x * y) % m using the native mulmod opcode.
    /// @param x First multiplicand.
    /// @param y Second multiplicand.
    /// @param m Modulus (must be > 0).
    /// @return result The result of (x * y) % m.
    function safeMulMod(
        uint256 x,
        uint256 y,
        uint256 m
    ) internal pure returns (uint256 result) {
        assembly {
            // Guard against division-by-zero: if m == 0, revert.
            if iszero(m) {
                mstore(0x00, 0x12) // Revert with "division by zero" error
                revert(0x1c, 0x04)
            }
            // Execute native mulmod(x, y, m)
            result := mulmod(x, y, m)
        }
    }

    /// @notice Compute (x + y) % m using the native addmod opcode.
    /// @param x First addend.
    /// @param y Second addend.
    /// @param m Modulus (must be > 0).
    /// @return result The result of (x + y) % m.
    function safeAddMod(
        uint256 x,
        uint256 y,
        uint256 m
    ) internal pure returns (uint256 result) {
        assembly {
            // Guard against division-by-zero.
            if iszero(m) {
                mstore(0x00, 0x12)
                revert(0x1c, 0x04)
            }
            // Execute native addmod(x, y, m)
            result := addmod(x, y, m)
        }
    }
}
