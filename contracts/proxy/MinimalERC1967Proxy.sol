// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MinimalERC1967Proxy
/// @notice A minimal ERC-1967 compliant upgradeable proxy written entirely
/// in Yul assembly. Reads the implementation address from the standard
/// ERC-1967 storage slot on every call and forwards via `delegatecall`,
/// avoiding the ~100-300 gas of high-level abstraction overhead (storage
/// struct access, library calls, redundant zero-checks) that typical
/// OpenZeppelin-style proxies add to every forwarded call.
/// @dev ERC-1967 (https://eips.ethereum.org/EIPS/eip-1967) fixes the
/// implementation address at storage slot
/// `bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)` so
/// that block explorers, wallets, and other tooling can locate the
/// upgrade target without needing the proxy's ABI. Using `keccak256(...) - 1`
/// (rather than the hash itself) is the standard's own safeguard against a
/// contract author choosing a colliding slot deliberately — subtracting 1
/// makes the slot not itself the preimage of any known hash.
contract MinimalERC1967Proxy {
    /// @dev bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 internal constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @notice Emitted whenever the implementation address changes,
    /// per the ERC-1967 spec (`Upgraded(address indexed implementation)`).
    event Upgraded(address indexed implementation);

    /// @param implementation_ The initial implementation address.
    constructor(address implementation_) {
        require(implementation_.code.length > 0, "MinimalERC1967Proxy: not a contract");
        bytes32 slot = _IMPLEMENTATION_SLOT;
        // Safety: writes to a single, standard, well-known storage slot
        // that this contract exclusively owns; not user-influenced.
        assembly {
            sstore(slot, implementation_)
        }
        emit Upgraded(implementation_);
    }

    /// @dev Catches all calls (including plain ETH transfers) and forwards
    /// them via `delegatecall` to whatever address is currently stored at
    /// `_IMPLEMENTATION_SLOT`.
    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    /// @notice Reads the implementation address from the ERC-1967 slot and
    /// forwards the current call's calldata to it via `delegatecall`,
    /// relaying the callee's return data (or revert reason) unchanged.
    /// @dev Safety: `sload` reads only `_IMPLEMENTATION_SLOT` — a fixed,
    /// non-user-controlled slot — so a caller cannot redirect the
    /// delegatecall target via calldata. The function never returns to
    /// Solidity control flow; it always terminates via `return`/`revert`
    /// inside the assembly block, matching the pattern used by
    /// `YulProxyForwarder` in this same directory (that contract instead
    /// bakes the implementation into an immutable, so cannot be upgraded —
    /// this one trades that immutability for the ERC-1967-mandated
    /// upgrade path).
    /// Gas: one SLOAD for the implementation address (2100 cold / 100
    /// warm) plus `calldatacopy`/`delegatecall`/`returndatacopy`,
    /// forwarding all remaining gas — no additional Solidity-level
    /// abstraction (no storage struct, no library dispatch, no redundant
    /// zero-address check beyond what `delegatecall` itself already
    /// reverts on when given a non-contract target).
    function _delegate() internal {
        assembly {
            let impl := sload(_IMPLEMENTATION_SLOT)

            // Copy incoming calldata to memory location 0x00.
            calldatacopy(0, 0, calldatasize())

            // Forward as a delegatecall, preserving msg.sender/msg.value
            // semantics of the original caller.
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)

            // Copy the returned data (success or revert reason).
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
