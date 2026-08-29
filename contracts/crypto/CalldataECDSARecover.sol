// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CalldataECDSARecover
 * @notice High-performance ecrecover wrapper using Yul assembly to load hash, v, r, s directly from calldata offsets into precompile 0x01.
 */
contract CalldataECDSARecover {
    /**
     * @notice Recover signer address directly from calldata using inline assembly and 0x01 precompile.
     * @param hash Message hash
     * @param v Recovery identifier v
     * @param r Signature component r
     * @param s Signature component s
     */
    function recoverCalldata(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view returns (address signer) {
        assembly {
            // Write hash, v, r, s into scratch space 0x00 -- 0x80
            mstore(0x00, hash)
            mstore(0x20, and(v, 0xff))
            mstore(0x40, r)
            mstore(0x60, s)

            // Call ecrecover precompile at address 0x01
            let success := staticcall(gas(), 0x01, 0x00, 0x80, 0x00, 0x20)

            if iszero(success) {
                mstore(0x00, 0)
                return(0x00, 0x20)
            }

            signer := mload(0x00)
        }
    }
}
