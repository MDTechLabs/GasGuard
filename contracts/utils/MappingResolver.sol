// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MappingResolver
/// @notice Gas-optimized nested mapping slot computation using inline Yul assembly.
/// @dev Computes keccak256-based storage slots for nested mappings directly in scratch
///      memory (0x00–0x40), avoiding Solidity's high-level memory allocation overhead.
library MappingResolver {
    /// @dev Compute the storage slot for a single mapping: keccak256(abi.encode(key, slot))
    /// @param slot The mapping's storage slot position.
    /// @param key The mapping key.
    /// @return result The computed storage slot.
    function computeSlot(bytes32 slot, bytes32 key) internal pure returns (bytes32 result) {
        // [key, slot] -> [result]
        // Safety: reads scratch 0x00-0x40 only; no storage reads/writes; no external calls.
        // Gas: keccak256(0x00, 0x40) costs 30 gas + word count * 6 gas.
        assembly {
            mstore(0x00, key)
            mstore(0x20, slot)
            result := keccak256(0x00, 0x40)
        }
    }

    /// @dev Compute the storage slot for a nested mapping: keccak256(abi.encode(key2, keccak256(abi.encode(key1, slot))))
    /// @param slot The outer mapping's storage slot position.
    /// @param key1 The outer mapping key.
    /// @param key2 The inner mapping key.
    /// @return result The computed storage slot.
    function computeNestedSlot(
        bytes32 slot,
        bytes32 key1,
        bytes32 key2
    ) internal pure returns (bytes32 result) {
        // [key1, slot, key2, innerSlot] -> [result]
        // Safety: reads scratch 0x00-0x40 only; no storage reads/writes; no external calls.
        // Gas: two keccak256(0x00, 0x40) calls; each costs 30 gas + word count * 6 gas.
        assembly {
            mstore(0x00, key1)
            mstore(0x20, slot)
            let innerSlot := keccak256(0x00, 0x40)

            mstore(0x00, key2)
            mstore(0x20, innerSlot)
            result := keccak256(0x00, 0x40)
        }
    }

    /// @dev Compute slot for address-keyed mapping.
    /// @param slot The mapping's storage slot.
    /// @param key The address key.
    /// @return result The computed storage slot.
    function computeAddrSlot(bytes32 slot, address key) internal pure returns (bytes32 result) {
        // [key, slot] -> [result]
        // Safety: reads scratch 0x00-0x40 only; no storage reads/writes; no external calls.
        // Gas: keccak256(0x00, 0x40) costs 30 gas + word count * 6 gas.
        assembly {
            mstore(0x00, key)
            mstore(0x20, slot)
            result := keccak256(0x00, 0x40)
        }
    }

    /// @dev Compute slot for uint256-keyed mapping.
    /// @param slot The mapping's storage slot.
    /// @param key The uint256 key.
    /// @return result The computed storage slot.
    function computeUintSlot(bytes32 slot, uint256 key) internal pure returns (bytes32 result) {
        // [key, slot] -> [result]
        // Safety: reads scratch 0x00-0x40 only; no storage reads/writes; no external calls.
        // Gas: keccak256(0x00, 0x40) costs 30 gas + word count * 6 gas.
        assembly {
            mstore(0x00, key)
            mstore(0x20, slot)
            result := keccak256(0x00, 0x40)
        }
    }
}

/// @title MappingResolverConsumer
/// @notice Example contract using MappingResolver for gas-efficient nested mapping reads.
contract MappingResolverConsumer {
    // Storage slot 0: balances mapping (address => uint256)
    // Storage slot 1: allowances mapping (address => mapping(address => uint256))
    // Storage slot 2: data mapping (address => mapping(uint256 => uint256))

    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;
    mapping(address => mapping(uint256 => uint256)) public data;

    event BalanceResolved(address indexed user, uint256 slot, uint256 value);
    event AllowanceResolved(address indexed owner, address indexed spender, uint256 value);

    /// @notice Read balance using assembly-computed slot.
    /// @param user The user address.
    /// @return value The balance value.
    function readBalanceAssembly(address user) external view returns (uint256 value) {
        bytes32 slot = MappingResolver.computeAddrSlot(bytes32(0), user);
        // [slot] -> [value]
        // Safety: reads scratch 0x00-0x40 only; reads storage (sload); no external calls.
        // Gas: SLOAD (2100 warm / 100 cold).
        assembly {
            value := sload(slot)
        }
    }

    /// @notice Read nested allowance using assembly-computed slot.
    /// @param owner The token owner.
    /// @param spender The spender address.
    /// @return value The allowance value.
    function readAllowanceAssembly(
        address owner,
        address spender
    ) external view returns (uint256 value) {
        bytes32 slot = MappingResolver.computeNestedSlot(
            bytes32(1),
            bytes32(uint256(uint160(owner))),
            bytes32(uint256(uint160(spender)))
        );
        // [slot] -> [value]
        // Safety: reads scratch 0x00-0x40 only; reads storage (sload); no external calls.
        // Gas: SLOAD (2100 warm / 100 cold).
        assembly {
            value := sload(slot)
        }
    }

    /// @notice Read nested uint-keyed data using assembly-computed slot.
    /// @param user The user address.
    /// @param key The uint256 key.
    /// @return value The data value.
    function readDataAssembly(address user, uint256 key) external view returns (uint256 value) {
        bytes32 slot = MappingResolver.computeNestedSlot(
            bytes32(2),
            bytes32(uint256(uint160(user))),
            bytes32(key)
        );
        // [slot] -> [value]
        // Safety: reads scratch 0x00-0x40 only; reads storage (sload); no external calls.
        // Gas: SLOAD (2100 warm / 100 cold).
        assembly {
            value := sload(slot)
        }
    }

    /// @notice Standard Solidity mapping read for gas comparison.
    function readBalanceSolidity(address user) external view returns (uint256) {
        return balances[user];
    }

    /// @notice Standard Solidity nested mapping read for gas comparison.
    function readAllowanceSolidity(
        address owner,
        address spender
    ) external view returns (uint256) {
        return allowances[owner][spender];
    }
}
