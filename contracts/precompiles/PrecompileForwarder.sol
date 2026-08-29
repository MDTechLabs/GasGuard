// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PrecompileForwarder
/// @notice Minimal Yul proxy for the ecrecover (0x01) and sha256 (0x02) precompiles.
/// @dev Starter implementation; modexp (0x05) and bn256Pairing (0x08) forwarding follow in a later PR.
library PrecompileForwarder {
    error PrecompileCallFailed(address precompile);

    function ecrecoverRaw(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal view returns (address signer) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, hash)
            mstore(add(ptr, 0x20), v)
            mstore(add(ptr, 0x40), r)
            mstore(add(ptr, 0x60), s)
            let ok := staticcall(gas(), 0x01, ptr, 0x80, ptr, 0x20)
            if iszero(ok) {
                revert(0, 0)
            }
            signer := mload(ptr)
        }
    }

    function sha256Raw(bytes memory data) internal view returns (bytes32 digest) {
        assembly {
            let len := mload(data)
            let ok := staticcall(gas(), 0x02, add(data, 0x20), len, 0x00, 0x20)
            if iszero(ok) {
                revert(0, 0)
            }
            digest := mload(0x00)
        }
    }
}
