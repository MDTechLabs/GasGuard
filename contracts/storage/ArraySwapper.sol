// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArraySwapper
 * @notice Optimizes storage array item overwrites and swap-and-pop actions using unchecked blocks.
 */
contract ArraySwapper {
    uint256[] public items;

    function pushItem(uint256 item) external {
        items.push(item);
    }

    /**
     * @notice Remove item at index using swap-and-pop wrapped in unchecked blocks.
     * @param index Valid array index to remove
     */
    function removeAtIndex(uint256 index) external {
        uint256 len = items.length;
        require(index < len, "Index out of bounds");

        unchecked {
            uint256 lastIndex = len - 1;
            if (index != lastIndex) {
                items[index] = items[lastIndex];
            }
            items.pop();
        }
    }
}
