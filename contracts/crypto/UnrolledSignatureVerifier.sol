// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title UnrolledSignatureVerifier
/// @notice Gas-optimized ECDSA multi-signature verification with loop-unrolled Yul
///         for fixed thresholds (3-of-5, 5-of-7) and a standard loop reference.
library UnrolledSignatureVerifier {
    error InvalidSignatureCount();
    error DuplicateSigner();
    error ThresholdNotMet();

    uint256 private constant MALLEABILITY_THRESHOLD =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @notice verify3of5  Unrolled 3-of-5 threshold verification.
    /// @param hash        The signed hash.
    /// @param sigs        325 bytes: 5 concatenated ECDSA sigs (65 bytes each: r|s|v).
    /// @param validators  5 authorized signers.
    function verify3of5(
        bytes32 hash,
        bytes calldata sigs,
        address[5] calldata validators
    ) external view returns (bool) {
        if (sigs.length != 325) revert InvalidSignatureCount();
        assembly {
            let voff := 0x44
            let v0 := calldataload(voff)
            let v1 := calldataload(add(voff, 0x20))
            let v2 := calldataload(add(voff, 0x40))
            let v3 := calldataload(add(voff, 0x60))
            let v4 := calldataload(add(voff, 0x80))

            if or(eq(v0, v1), or(eq(v0, v2), or(eq(v0, v3), or(eq(v0, v4),
               or(eq(v1, v2), or(eq(v1, v3), or(eq(v1, v4),
               or(eq(v2, v3), or(eq(v2, v4),
               eq(v3, v4)))))))))) {
                mstore(0x00, 0x8044bb33)
                revert(0x00, 0x04)
            }

            let soff := sigs.offset

            function recover(h, off) -> signer {
                let r := calldataload(off)
                let s := calldataload(add(off, 0x20))
                let vb := byte(0, calldataload(add(off, 0x40)))
                if lt(vb, 27) { vb := add(vb, 27) }
                let ptr := mload(0x40)
                mstore(ptr, h)
                mstore(add(ptr, 0x20), vb)
                mstore(add(ptr, 0x40), r)
                mstore(add(ptr, 0x60), s)
                let ok := staticcall(gas(), 0x01, ptr, 0x80, ptr, 0x20)
                if iszero(ok) { revert(0, 0) }
                signer := mload(ptr)
                if iszero(signer) { revert(0, 0) }
            }

            let s0 := recover(hash, soff)
            let s1 := recover(hash, add(soff, 65))
            let s2 := recover(hash, add(soff, 130))
            let s3 := recover(hash, add(soff, 195))
            let s4 := recover(hash, add(soff, 260))

            if or(eq(s0, s1), or(eq(s0, s2), or(eq(s0, s3), or(eq(s0, s4),
               or(eq(s1, s2), or(eq(s1, s3), or(eq(s1, s4),
               or(eq(s2, s3), or(eq(s2, s4),
               eq(s3, s4)))))))))) {
                mstore(0x00, 0x8044bb33)
                revert(0x00, 0x04)
            }

            let count := 0
            if or(eq(s0, v0), or(eq(s0, v1), or(eq(s0, v2), or(eq(s0, v3), eq(s0, v4))))) { count := add(count, 1) }
            if or(eq(s1, v0), or(eq(s1, v1), or(eq(s1, v2), or(eq(s1, v3), eq(s1, v4))))) { count := add(count, 1) }
            if or(eq(s2, v0), or(eq(s2, v1), or(eq(s2, v2), or(eq(s2, v3), eq(s2, v4))))) { count := add(count, 1) }
            if or(eq(s3, v0), or(eq(s3, v1), or(eq(s3, v2), or(eq(s3, v3), eq(s3, v4))))) { count := add(count, 1) }
            if or(eq(s4, v0), or(eq(s4, v1), or(eq(s4, v2), or(eq(s4, v3), eq(s4, v4))))) { count := add(count, 1) }

            if lt(count, 3) {
                mstore(0x00, 0x59fa4a93)
                revert(0x00, 0x04)
            }

            mstore(0x00, 0x01)
            return(0x00, 0x20)
        }
    }

    /// @notice verify5of7  Unrolled 5-of-7 threshold verification.
    /// @param hash        The signed hash.
    /// @param sigs        455 bytes: 7 concatenated ECDSA sigs (65 bytes each: r|s|v).
    /// @param validators  7 authorized signers.
    function verify5of7(
        bytes32 hash,
        bytes calldata sigs,
        address[7] calldata validators
    ) external view returns (bool) {
        if (sigs.length != 455) revert InvalidSignatureCount();
        assembly {
            let v0 := calldataload(0x44)
            let v1 := calldataload(0x64)
            let v2 := calldataload(0x84)
            let v3 := calldataload(0xA4)
            let v4 := calldataload(0xC4)
            let v5 := calldataload(0xE4)
            let v6 := calldataload(0x104)

            if or(eq(v0, v1), or(eq(v0, v2), or(eq(v0, v3), or(eq(v0, v4), or(eq(v0, v5), or(eq(v0, v6),
               or(eq(v1, v2), or(eq(v1, v3), or(eq(v1, v4), or(eq(v1, v5), or(eq(v1, v6),
               or(eq(v2, v3), or(eq(v2, v4), or(eq(v2, v5), or(eq(v2, v6),
               or(eq(v3, v4), or(eq(v3, v5), or(eq(v3, v6),
               or(eq(v4, v5), or(eq(v4, v6),
               eq(v5, v6)))))))))))))))))))))) {
                mstore(0x00, 0x8044bb33)
                revert(0x00, 0x04)
            }

            let soff := sigs.offset

            function recover(h, off) -> signer {
                let r := calldataload(off)
                let s := calldataload(add(off, 0x20))
                let vb := byte(0, calldataload(add(off, 0x40)))
                if lt(vb, 27) { vb := add(vb, 27) }
                let ptr := mload(0x40)
                mstore(ptr, h)
                mstore(add(ptr, 0x20), vb)
                mstore(add(ptr, 0x40), r)
                mstore(add(ptr, 0x60), s)
                let ok := staticcall(gas(), 0x01, ptr, 0x80, ptr, 0x20)
                if iszero(ok) { revert(0, 0) }
                signer := mload(ptr)
                if iszero(signer) { revert(0, 0) }
            }

            let s0 := recover(hash, soff)
            let s1 := recover(hash, add(soff, 65))
            let s2 := recover(hash, add(soff, 130))
            let s3 := recover(hash, add(soff, 195))
            let s4 := recover(hash, add(soff, 260))
            let s5 := recover(hash, add(soff, 325))
            let s6 := recover(hash, add(soff, 390))

            if or(eq(s0, s1), or(eq(s0, s2), or(eq(s0, s3), or(eq(s0, s4), or(eq(s0, s5), or(eq(s0, s6),
               or(eq(s1, s2), or(eq(s1, s3), or(eq(s1, s4), or(eq(s1, s5), or(eq(s1, s6),
               or(eq(s2, s3), or(eq(s2, s4), or(eq(s2, s5), or(eq(s2, s6),
               or(eq(s3, s4), or(eq(s3, s5), or(eq(s3, s6),
               or(eq(s4, s5), or(eq(s4, s6),
               eq(s5, s6)))))))))))))))))))))) {
                mstore(0x00, 0x8044bb33)
                revert(0x00, 0x04)
            }

            let count := 0
            if or(eq(s0, v0), or(eq(s0, v1), or(eq(s0, v2), or(eq(s0, v3), or(eq(s0, v4), or(eq(s0, v5), eq(s0, v6))))))) { count := add(count, 1) }
            if or(eq(s1, v0), or(eq(s1, v1), or(eq(s1, v2), or(eq(s1, v3), or(eq(s1, v4), or(eq(s1, v5), eq(s1, v6))))))) { count := add(count, 1) }
            if or(eq(s2, v0), or(eq(s2, v1), or(eq(s2, v2), or(eq(s2, v3), or(eq(s2, v4), or(eq(s2, v5), eq(s2, v6))))))) { count := add(count, 1) }
            if or(eq(s3, v0), or(eq(s3, v1), or(eq(s3, v2), or(eq(s3, v3), or(eq(s3, v4), or(eq(s3, v5), eq(s3, v6))))))) { count := add(count, 1) }
            if or(eq(s4, v0), or(eq(s4, v1), or(eq(s4, v2), or(eq(s4, v3), or(eq(s4, v4), or(eq(s4, v5), eq(s4, v6))))))) { count := add(count, 1) }
            if or(eq(s5, v0), or(eq(s5, v1), or(eq(s5, v2), or(eq(s5, v3), or(eq(s5, v4), or(eq(s5, v5), eq(s5, v6))))))) { count := add(count, 1) }
            if or(eq(s6, v0), or(eq(s6, v1), or(eq(s6, v2), or(eq(s6, v3), or(eq(s6, v4), or(eq(s6, v5), eq(s6, v6))))))) { count := add(count, 1) }

            if lt(count, 5) {
                mstore(0x00, 0x59fa4a93)
                revert(0x00, 0x04)
            }

            mstore(0x00, 0x01)
            return(0x00, 0x20)
        }
    }

    /// @notice verifyThreshold  Standard loop-based threshold verification (reference).
    /// @param hash             The signed hash.
    /// @param sigs             Array of ECDSA signatures (each 65 bytes).
    /// @param validators       Array of authorized signers.
    /// @param threshold        Minimum number of matching signatures required.
    function verifyThreshold(
        bytes32 hash,
        bytes[] calldata sigs,
        address[] calldata validators,
        uint256 threshold
    ) external view returns (bool) {
        uint256 n = sigs.length;
        if (n != validators.length) revert InvalidSignatureCount();
        if (threshold > n) revert InvalidSignatureCount();

        for (uint256 i = 0; i < validators.length; i++) {
            for (uint256 j = i + 1; j < validators.length; j++) {
                if (validators[i] == validators[j]) revert DuplicateSigner();
            }
        }

        address[] memory recovered = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes calldata sig = sigs[i];
            if (sig.length != 65) revert InvalidSignatureCount();
            bytes32 r = bytes32(sig[0:32]);
            bytes32 s = bytes32(sig[32:64]);
            uint8 v = uint8(sig[64]);
            if (uint256(s) > MALLEABILITY_THRESHOLD) revert InvalidSignatureCount();
            if (v < 27) v += 27;
            address signer = ecrecover(hash, v, r, s);
            if (signer == address(0)) revert InvalidSignatureCount();
            for (uint256 k = 0; k < i; k++) {
                if (recovered[k] == signer) revert DuplicateSigner();
            }
            recovered[i] = signer;
        }

        uint256 count;
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = 0; j < validators.length; j++) {
                if (recovered[i] == validators[j]) {
                    count++;
                    break;
                }
            }
        }

        if (count < threshold) revert ThresholdNotMet();
        return true;
    }
}
