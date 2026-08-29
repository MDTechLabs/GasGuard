// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title GasOptimizedReentrancyGuard
/// @notice Reentrancy guard using 1/2 sentinel values so re-entry checks always
///         hit a warm storage slot (2,900 gas) instead of a cold 0->1 write (20,000 gas).
abstract contract GasOptimizedReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    error ReentrantCall();

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}
