// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title YulEIP712
/// @notice Gas-optimized EIP-712 hashing using inline assembly.
contract YulEIP712 {

    string public constant NAME = "GasGuard";
    string public constant VERSION = "1";

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    bytes32 internal immutable NAME_HASH;
    bytes32 internal immutable VERSION_HASH;

    constructor() {
        NAME_HASH = keccak256(bytes(NAME));
        VERSION_HASH = keccak256(bytes(VERSION));
    }

    function domainSeparator() public view returns (bytes32 separator) {
        bytes32 typeHash = EIP712_DOMAIN_TYPEHASH;
        bytes32 nameHash = NAME_HASH;
        bytes32 versionHash = VERSION_HASH;

        assembly {
            let ptr := mload(0x40)

            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), nameHash)
            mstore(add(ptr, 0x40), versionHash)
            mstore(add(ptr, 0x60), chainid())
            mstore(add(ptr, 0x80), address())

            separator := keccak256(ptr, 160)
        }
    }

    function hashTypedData(
        bytes32 structHash
    ) public view returns (bytes32 digest) {

        bytes32 separator = domainSeparator();

        assembly {
            let ptr := mload(0x40)

            mstore8(ptr, 0x19)
            mstore8(add(ptr, 1), 0x01)

            mstore(add(ptr, 2), separator)

            mstore(add(ptr, 34), structHash)

            digest := keccak256(ptr, 66)
        }
    }

    function hashStruct(
        bytes32 typeHash,
        bytes32 field1,
        bytes32 field2
    ) public pure returns (bytes32 result) {

        assembly {
            let ptr := mload(0x40)

            mstore(ptr, typeHash)
            mstore(add(ptr, 32), field1)
            mstore(add(ptr, 64), field2)

            result := keccak256(ptr, 96)
        }
    }
}