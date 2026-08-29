// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {YulSafeTransfer} from "./YulSafeTransfer.sol";

/// @title YulSafeTransferHarness
/// @notice Test-only external wrapper around `YulSafeTransfer`.
/// @dev `safeTransfer`/`safeTransferFrom` are `internal` so callers pay no
///      extra CALL overhead — the Yul body is inlined directly into whatever
///      contract uses the library. Internal functions have no ABI entry
///      point of their own, so this harness exists purely to give the test
///      suite an externally-callable surface; it adds no behavior beyond
///      forwarding into the library.
contract YulSafeTransferHarness {
    function safeTransfer(address token, address to, uint256 amount) external {
        YulSafeTransfer.safeTransfer(token, to, amount);
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) external {
        YulSafeTransfer.safeTransferFrom(token, from, to, amount);
    }
}
