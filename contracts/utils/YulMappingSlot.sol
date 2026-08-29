// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulMappingSlot
/// @notice Gas-optimized storage slot calculator for a single-level
/// `mapping(address => uint256)`, written directly in Yul scratch-space
/// operations instead of relying on `abi.encode` + `keccak256`.
/// @dev Standard Solidity mapping layout: for a mapping declared at storage
/// slot `baseSlot`, the slot of `mapping[key]` is
/// `keccak256(abi.encode(key, baseSlot))` — the key written first (left,
/// bytes 0-31), the mapping's own slot second (right, bytes 32-63), then
/// hashed as a single 64-byte region. This matches Solidity's own codegen
/// for a top-level mapping (see the Solidity docs, "Layout of State
/// Variables in Storage" > "Mappings and Dynamic Arrays"), so the value at
/// the returned slot is byte-for-byte the same value the compiler itself
/// would read for `mapping[key]`.
library YulMappingSlot {
    /// @notice Computes the storage slot of `mapping[key]` for a
    /// `mapping(address => uint256)` declared at `baseSlot`.
    /// @param key The mapping key (an address, left-padded to 32 bytes as
    /// `uint256` per Solidity's ABI encoding rules).
    /// @param baseSlot The storage slot the mapping itself occupies.
    /// @return slot The storage slot holding `mapping[key]`'s value.
    function computeSlot(address key, uint256 baseSlot) internal pure returns (bytes32 slot) {
        // [key, baseSlot] -> [slot]
        // Safety: writes only to scratch memory (0x00-0x40, reserved for
        // this exact purpose by the Solidity ABI spec); no storage access,
        // no external calls; does not touch or rely on the free memory
        // pointer (0x40), so it is safe to call from any context, including
        // inside another assembly block that has already written to
        // scratch space for an unrelated purpose (each call re-initializes
        // both words before hashing).
        // Gas: two MSTOREs (3 gas each) + keccak256(0x00, 0x40) (30 gas +
        // 6 gas/word * 2 words = 42 gas) instead of `abi.encode`'s ABI
        // encoder overhead (memory allocation, free-pointer bump, and a
        // dynamic-length-aware copy loop) for the same two-word input.
        assembly {
            mstore(0x00, key)
            mstore(0x20, baseSlot)
            slot := keccak256(0x00, 0x40)
        }
    }

    /// @notice Reads `mapping[key]`'s value directly via the computed slot.
    /// @param key The mapping key.
    /// @param baseSlot The storage slot the mapping itself occupies.
    /// @return value The value stored at `mapping[key]`.
    function readValue(address key, uint256 baseSlot) internal view returns (uint256 value) {
        bytes32 slot = computeSlot(key, baseSlot);
        // [slot] -> [value]
        // Safety: single SLOAD at the just-computed slot; no other state
        // access.
        // Gas: SLOAD (2100 cold / 100 warm).
        assembly {
            value := sload(slot)
        }
    }

    /// @notice Writes `value` to `mapping[key]` directly via the computed
    /// slot.
    /// @param key The mapping key.
    /// @param baseSlot The storage slot the mapping itself occupies.
    /// @param value The value to store.
    function writeValue(address key, uint256 baseSlot, uint256 value) internal {
        bytes32 slot = computeSlot(key, baseSlot);
        // [slot, value] -> []
        // Safety: single SSTORE at the just-computed slot; no other state
        // access; no reentrancy surface (no external calls made).
        // Gas: SSTORE (20000 cold-zero-to-nonzero / 2900 warm, per EIP-2929
        // + EIP-2200 rules — identical cost profile to a compiler-generated
        // mapping write to the same slot).
        assembly {
            sstore(slot, value)
        }
    }
}

/// @title YulMappingSlotConsumer
/// @notice Example contract pairing a real `mapping(address => uint256)`
/// with `YulMappingSlot`, so the library's output can be checked against
/// the compiler's own mapping storage layout for the exact same slot.
contract YulMappingSlotConsumer {
    // Storage slot 0.
    mapping(address => uint256) public balances;

    /// @notice Returns the storage slot `YulMappingSlot` computes for
    /// `balances[user]` (`balances` occupies slot 0).
    function slotFor(address user) external pure returns (bytes32) {
        return YulMappingSlot.computeSlot(user, 0);
    }

    /// @notice Reads `balances[user]` using the Yul-computed slot instead
    /// of the compiler-generated mapping accessor.
    function readAssembly(address user) external view returns (uint256) {
        return YulMappingSlot.readValue(user, 0);
    }

    /// @notice Writes `balances[user]` using the Yul-computed slot instead
    /// of a normal Solidity assignment.
    function writeAssembly(address user, uint256 value) external {
        YulMappingSlot.writeValue(user, 0, value);
    }

    /// @notice Standard Solidity mapping write, for parity testing against
    /// `writeAssembly`/`readAssembly`.
    function writeSolidity(address user, uint256 value) external {
        balances[user] = value;
    }
}
