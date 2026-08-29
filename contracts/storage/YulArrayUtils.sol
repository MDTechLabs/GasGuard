// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulArrayUtils
/// @notice Generic Yul-assembly helper for O(1) "swap-and-pop" removal from
/// storage arrays, replacing Solidity's default `array[i] = array[array.length - 1];
/// array.pop();` pattern with direct opcode-level `sload`/`sstore` access.
/// @dev Solidity already implements swap-and-pop this way under the hood for
/// dynamic storage arrays, but the high-level version pays for an extra
/// bounds-checked `sload`/`sstore` round trip per step and cannot be reused
/// across value types without duplicating the logic. This library exposes
/// the same operation as a single assembly block per element type, callable
/// directly on any `storage` array reference via `arr.slot`.
library YulArrayUtils {
    /// @dev Thrown when `index` is not a valid element of the array.
    error IndexOutOfBounds();

    /// @notice Removes the element at `index` from `arr` in O(1) time by
    /// moving the last element into `index`'s slot and shrinking the array,
    /// instead of shifting every subsequent element.
    /// @param arr The storage array to mutate.
    /// @param index The index to remove.
    function removeAtIndex(uint256[] storage arr, uint256 index) internal {
        uint256 length = arr.length;
        if (index >= length) revert IndexOutOfBounds();

        assembly {
            // Dynamic storage arrays store their length at `arr.slot` and
            // their elements starting at `keccak256(arr.slot)`.
            mstore(0x00, arr.slot)
            let baseSlot := keccak256(0x00, 0x20)

            let lastIndex := sub(length, 1)
            let lastSlot := add(baseSlot, lastIndex)
            let lastValue := sload(lastSlot)

            // Move the last element into the removed slot (no-op if
            // `index == lastIndex`, i.e. removing the tail element).
            sstore(add(baseSlot, index), lastValue)

            // Zero out the now-vacated final slot to claim the storage
            // refund, then shrink the array length.
            sstore(lastSlot, 0)
            sstore(arr.slot, lastIndex)
        }
    }

    /// @notice `address[]` overload of {removeAtIndex}, identical semantics.
    /// @param arr The storage array to mutate.
    /// @param index The index to remove.
    function removeAtIndex(address[] storage arr, uint256 index) internal {
        uint256 length = arr.length;
        if (index >= length) revert IndexOutOfBounds();

        assembly {
            mstore(0x00, arr.slot)
            let baseSlot := keccak256(0x00, 0x20)

            let lastIndex := sub(length, 1)
            let lastSlot := add(baseSlot, lastIndex)
            let lastValue := sload(lastSlot)

            sstore(add(baseSlot, index), lastValue)
            sstore(lastSlot, 0)
            sstore(arr.slot, lastIndex)
        }
    }
}

/// @title YulArrayUtilsHarness
/// @notice Thin, testable wrapper so {YulArrayUtils}'s internal functions can
/// be exercised via external calls from tests.
contract YulArrayUtilsHarness {
    using YulArrayUtils for uint256[];
    using YulArrayUtils for address[];

    uint256[] private numbers;
    address[] private addresses;

    function pushNumber(uint256 value) external {
        numbers.push(value);
    }

    function pushAddress(address value) external {
        addresses.push(value);
    }

    function removeNumberAt(uint256 index) external {
        numbers.removeAtIndex(index);
    }

    function removeAddressAt(uint256 index) external {
        addresses.removeAtIndex(index);
    }

    function getNumbers() external view returns (uint256[] memory) {
        return numbers;
    }

    function getAddresses() external view returns (address[] memory) {
        return addresses;
    }

    function numbersLength() external view returns (uint256) {
        return numbers.length;
    }

    function addressesLength() external view returns (uint256) {
        return addresses.length;
    }
}
