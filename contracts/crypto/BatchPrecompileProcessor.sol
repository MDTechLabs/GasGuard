// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BatchPrecompileProcessor
/// @notice Zero-allocation batched precompile multicall processor written in Yul assembly.
/// @dev All intermediate input/output buffers are reused from a single memory allocation.
///      The free memory pointer (0x40) is read once at the start and never updated during
///      the processing loop, eliminating per-iteration memory expansion costs.
///      Precompile 0x01 (ecrecover) and 0x05 (modexp) are invoked via staticcall.
library BatchPrecompileProcessor {
    error BatchLengthMismatch();
    error PrecompileCallFailed();

    /// @notice Batch-verify ECDSA signatures via precompile 0x01.
    /// @dev Each iteration packs (hash, v, r, s) into a 128-byte reusable buffer,
    ///      invokes staticcall, and stores the status flag (non-zero address = valid).
    ///      Reverts with `PrecompileCallFailed` if the EVM-level staticcall fails.
    /// @param hashes Array of signed message hashes.
    /// @param v Array of recovery IDs.
    /// @param r Array of R components.
    /// @param s Array of S components.
    /// @return results Boolean array where true indicates a valid signature.
    function batchVerify(
        bytes32[] calldata hashes,
        uint8[] calldata v,
        bytes32[] calldata r,
        bytes32[] calldata s
    ) internal view returns (bool[] memory results) {
        uint256 len = hashes.length;
        if (len != v.length || len != r.length || len != s.length) {
            revert BatchLengthMismatch();
        }

        results = new bool[](len);

        assembly {
            let ptr := mload(0x40)
            let resultsData := add(results, 0x20)

            for { let i := 0 } lt(i, len) { i := add(i, 1) } {
                mstore(ptr, calldataload(add(hashes.offset, mul(i, 32))))
                mstore(add(ptr, 0x20), calldataload(add(v.offset, mul(i, 32))))
                mstore(add(ptr, 0x40), calldataload(add(r.offset, mul(i, 32))))
                mstore(add(ptr, 0x60), calldataload(add(s.offset, mul(i, 32))))

                let ok := staticcall(gas(), 0x01, ptr, 0x80, ptr, 0x20)
                if iszero(ok) {
                    mstore(0x00, 0x0dbb13f4)
                    revert(0x00, 0x04)
                }

                mstore(add(resultsData, mul(i, 32)), iszero(iszero(mload(ptr))))
            }
        }
    }

    /// @notice Batch-compute modular exponentiation via precompile 0x05.
    /// @dev Each iteration packs the modexp header (baseLen, expLen, modLen = 32 each)
    ///      followed by the operands into a 192-byte reusable buffer, invokes staticcall,
    ///      and stores the result. Each operand is a full uint256 (32 bytes).
    /// @param bases Array of base values.
    /// @param exps Array of exponent values.
    /// @param mods Array of modulus values.
    /// @return results Array of modexp results (base^exp % mod).
    function batchModexp(
        uint256[] calldata bases,
        uint256[] calldata exps,
        uint256[] calldata mods
    ) internal view returns (uint256[] memory results) {
        uint256 len = bases.length;
        if (len != exps.length || len != mods.length) {
            revert BatchLengthMismatch();
        }

        results = new uint256[](len);

        assembly {
            let ptr := mload(0x40)
            let resultsData := add(results, 0x20)

            for { let i := 0 } lt(i, len) { i := add(i, 1) } {
                mstore(ptr, 0x20)
                mstore(add(ptr, 0x20), 0x20)
                mstore(add(ptr, 0x40), 0x20)
                mstore(add(ptr, 0x60), calldataload(add(bases.offset, mul(i, 32))))
                mstore(add(ptr, 0x80), calldataload(add(exps.offset, mul(i, 32))))
                mstore(add(ptr, 0xA0), calldataload(add(mods.offset, mul(i, 32))))

                let ok := staticcall(gas(), 0x05, ptr, 0xC0, ptr, 0x20)
                if iszero(ok) {
                    mstore(0x00, 0x0dbb13f4)
                    revert(0x00, 0x04)
                }

                mstore(add(resultsData, mul(i, 32)), mload(ptr))
            }
        }
    }
}
