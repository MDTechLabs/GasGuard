// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulECDSARecover
/// @notice Gas-efficient ECDSA recovery with malleability protection, no intermediate memory copies.
library YulECDSARecover {
    // secp256k1n / 2
    uint256 internal constant MALLEABILITY_THRESHOLD =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    error InvalidSignatureS();
    error RecoverFailed();

    function recover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal view returns (address signer) {
        if (uint256(s) > MALLEABILITY_THRESHOLD) revert InvalidSignatureS();

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
        if (signer == address(0)) revert RecoverFailed();
    }

    /// @dev Unpacks r, s, v directly from a 65-byte calldata signature slice.
    function recoverFromCalldata(bytes32 hash, bytes calldata signature) internal view returns (address) {
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        return recover(hash, v, r, s);
    }
}
