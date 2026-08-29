// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract G025Samples {
    function postDecrement() external pure returns (uint256 total) {
        for (uint256 i = 10; i > 0; i--) {
            total += i;
        }
    }

    function preDecrement() external pure returns (uint256 total) {
        for (uint256 i = 10; i > 0; --i) {
            total += i;
        }
    }
}