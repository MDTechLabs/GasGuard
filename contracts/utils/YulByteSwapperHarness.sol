// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {YulByteSwapper} from './YulByteSwapper.sol';

contract YulByteSwapperHarness {
    function swap(bytes32 value) external pure returns (bytes32) {
        return YulByteSwapper.swap(value);
    }

    function swapUint256(uint256 value) external pure returns (uint256) {
        return YulByteSwapper.swapUint256(value);
    }
}