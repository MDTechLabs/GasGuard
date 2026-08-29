// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Sample Solidity code that triggers G018: manual memory array copy in a loop.
// This should be flagged because it copies elements one-by-one instead of using MCOPY.

contract G018Sample {
    function copyArray(uint256[] memory src, uint256 length)
        public
        pure
        returns (uint256[] memory dst)
    {
        dst = new uint256[](length);
        // G018: Element-by-element memory copy loop
        for (uint256 i = 0; i < length; i++) {
            dst[i] = src[i];
        }
    }
}
