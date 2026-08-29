// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract G014Samples {
    uint256[] public storageArray;

    function badLoop() external {
        for (uint256 i; i < storageArray.length; i++) {
            storageArray[i];
        }
    }

    function badWhile() external {
        uint256 i;

        while (i < storageArray.length) {
            i++;
        }
    }

    function badIf() external view returns (bool) {
        if (storageArray.length > 0) {
            return true;
        }

        return false;
    }

    function goodLoop() external {
        uint256 length = storageArray.length;

        for (uint256 i; i < length; i++) {
            storageArray[i];
        }
    }

    function memoryArray(uint256[] memory arr) external pure returns (uint256) {
        for (uint256 i; i < arr.length; i++) {
            return arr[i];
        }

        return 0;
    }

    function calldataArray(uint256[] calldata arr) external pure returns (uint256) {
        for (uint256 i; i < arr.length; i++) {
            return arr[i];
        }

        return 0;
    }
}