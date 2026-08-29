// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract G023Samples {
    function oversized() external pure {
        uint256[] memory arr = new uint256[](100);
        arr[0] = 1;
    }

    function appropriate() external pure {
        uint256 size = 10;
        uint256[] memory arr = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            arr[i] = i;
        }
    }
}
