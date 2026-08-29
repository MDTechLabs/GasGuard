// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulProxyForwarder
/// @notice Minimal, zero-overhead `delegatecall` forwarder implemented
/// entirely in Yul assembly. Forwards all incoming calldata to a fixed
/// implementation address and relays the return data (or revert reason)
/// transparently, without any high-level Solidity stack manipulation.
/// @dev Intended to be deployed as the runtime code behind a proxy pointer
/// (e.g. an EIP-1967 storage slot) or used directly as a fallback-only
/// forwarding contract when the implementation address is immutable.
contract YulProxyForwarder {
    /// @notice The address all calls are delegated to.
    address public immutable implementation;

    constructor(address implementation_) {
        implementation = implementation_;
    }

    /// @dev Catches all calls (including those with no matching function
    /// selector and plain ETH transfers) and forwards them via
    /// `delegatecall` to `implementation`.
    fallback() external payable {
        _forward(implementation);
    }

    receive() external payable {
        _forward(implementation);
    }

    /// @notice Forwards the current call's calldata to `impl` via
    /// `delegatecall` and returns/reverts with the callee's return data.
    /// @dev Safety: this function never returns to Solidity control flow —
    /// it always terminates the call via `return` or `revert` inside the
    /// assembly block. No storage is written directly by this function;
    /// all state changes happen in `impl`'s execution context via
    /// delegatecall. Gas: copies calldata/returndata once each
    /// (`calldatacopy`/`returndatacopy`), forwards all remaining gas.
    function _forward(address impl) internal {
        assembly {
            // Copy incoming calldata to memory location 0x00.
            calldatacopy(0, 0, calldatasize())

            // Forward the call as a delegatecall, preserving msg.sender
            // and msg.value semantics of the original caller.
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)

            // Copy the returned data (success or revert reason) to memory.
            returndatacopy(0, 0, returndatasize())

            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
