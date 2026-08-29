// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CodeCheckLib
/// @notice Gas-optimized contract existence check using raw `extcodesize`.
library CodeCheckLib {
    /// @notice Returns true if `target` has deployed code.
    /// @dev Skips the stack management overhead of high-level `.code.length`.
    function isContract(address target) internal view returns (bool result) {
        // [target] -> [result]
        // Safety: reads scratch 0x00-0x40 only; reads storage (extcodesize); no external calls.
        // Gas: extcodesize is a cold access (~2600 gas) if not previously accessed.
        assembly {
            result := gt(extcodesize(target), 0)
        }
    }
}
