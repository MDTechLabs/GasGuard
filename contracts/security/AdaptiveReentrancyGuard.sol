// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AdaptiveReentrancyGuard
/// @notice Reentrancy guard that uses EIP-1153 transient storage (TSTORE/TLOAD)
///         when deployed in transient mode, falling back to SSTORE-based locking
///         for non-Cancun EVM targets.
/// @dev Mode is selected at construction. Transient mode costs ~100 gas per
///      lock/unlock vs ~5000 gas for storage-based guards.
abstract contract AdaptiveReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    bool private immutable _transient;

    error ReentrantCall();

    constructor(bool useTransient) {
        _transient = useTransient;
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        if (_transient) {
            assembly {
                if tload(0) { revert(0, 0) }
                tstore(0, 1)
            }
            _;
            assembly { tstore(0, 0) }
        } else {
            if (_status == _ENTERED) revert ReentrantCall();
            _status = _ENTERED;
            _;
            _status = _NOT_ENTERED;
        }
    }
}

/// @title AdaptiveReentrancyGuardMock
/// @dev Test-only mock exposing nonReentrant for both modes.
contract AdaptiveReentrancyGuardMock is AdaptiveReentrancyGuard {
    constructor(bool useTransient) AdaptiveReentrancyGuard(useTransient) {}

    function enter() external nonReentrant {}

    function reenter() external nonReentrant {
        this.reenter();
    }
}
