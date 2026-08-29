// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EventRegistry
 * @notice Refactors runtime keccak256 event signature hashing to compile-time constant topic selectors.
 * @dev All topic selectors below are `bytes32 constant` values. Because their inputs are
 *      string literals, `keccak256(...)` is folded by the Solidity compiler at compile time
 *      (verified by `EventRegistry.test.ts`, which asserts each constant equals the offline
 *      `ethers.id(...)` hash of its canonical event signature) — no hashing opcode runs at
 *      call time. `emitViaAssembly` further demonstrates that a low-level `log` call can
 *      consume these constants directly as topics without recomputing them.
 */
contract EventRegistry {
    // Pre-computed compile-time constant event topics
    bytes32 public constant EVENT_TRANSFER_TOPIC = keccak256("Transfer(address,address,uint256)");
    bytes32 public constant EVENT_APPROVAL_TOPIC = keccak256("Approval(address,address,uint256)");
    bytes32 public constant EVENT_APPROVAL_FOR_ALL_TOPIC =
        keccak256("ApprovalForAll(address,address,bool)");
    bytes32 public constant EVENT_OWNERSHIP_TRANSFERRED_TOPIC =
        keccak256("OwnershipTransferred(address,address)");

    event LogRegistered(bytes32 indexed topic, address indexed emitter);

    function logEvent(address emitter) external {
        emit LogRegistered(EVENT_TRANSFER_TOPIC, emitter);
    }

    /// @notice Emits a raw `Approval` log via a low-level `log3` call,
    /// passing the compile-time constant topic0 directly alongside the
    /// indexed `owner`/`spender` topics — no runtime keccak256 hashing.
    function emitViaAssembly(address owner, address spender, uint256 value) external {
        bytes32 topic0 = EVENT_APPROVAL_TOPIC;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, value)
            log3(ptr, 0x20, topic0, owner, spender)
        }
    }
}
