// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {YulMathLib} from "./YulMathLib.sol";

/// @title YulMathLibHarness
/// @notice Test-only external wrapper around `YulMathLib`.
/// @dev `YulMathLib.mulDivDown` is deliberately `internal` so that consumers
///      pay zero call overhead (the Yul body is inlined directly at each call
///      site instead of requiring a CALL/DELEGATECALL). Internal library
///      functions have no ABI entry point of their own, so this thin harness
///      exists purely to give the test suite something externally callable —
///      it adds no logic of its own beyond forwarding to the library.
contract YulMathLibHarness {
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
        return YulMathLib.mulDivDown(x, y, denominator);
    }
}
