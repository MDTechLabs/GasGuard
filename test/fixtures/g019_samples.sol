// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract G019Sample {
    uint256 public value;

    function redundantViewAccess() external view returns (uint256, uint256) {
        return (value, value);
    }
}
