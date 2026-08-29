// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulMerkleVerifier
/// @notice Zero-allocation Merkle proof verification written entirely in Yul assembly.
/// @dev Processes proof path validation without any dynamic memory allocation.
///      All intermediate leaf hashes are computed strictly in scratch memory (0x00–0x40).
///      Sibling nodes are ordered using low-level bitwise comparison and hashed via
///      keccak256(0x00, 0x40). This avoids the repeated mstore/memory-pointer updates
///      that OpenZeppelin's MerkleProof library performs for every leaf hashing step.
library YulMerkleVerifier {
    error InvalidProof();
    error InvalidLeaf();
    error InvalidProofLength();

    /// @notice Verifies a Merkle proof against a root, leaf, and proof elements.
    /// @dev Uses only scratch memory (0x00–0x40) for intermediate hashes.
    ///      No dynamic memory allocation occurs during proof processing.
    ///      Sibling nodes are ordered using low-level bitwise comparison
    ///      so the smaller hash is always on the left (canonical ordering).
    /// @param root The expected Merkle root.
    /// @param leaf The leaf value to verify.
    /// @param proof The array of sibling proof elements in order from leaf to root.
    /// @return True if the proof is valid, false otherwise.
    function verifyProof(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external pure returns (bool) {
        if (proof.length == 0) {
            return leaf == root;
        }

        if (proof.length > 256) {
            revert InvalidProofLength();
        }

        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];

            assembly {
                // Load current computed hash and sibling into scratch memory.
                // [computedHash, sibling] at 0x00–0x40
                mstore(0x00, computedHash)
                mstore(0x20, sibling)

                // Canonical ordering via bitwise comparison.
                // gt returns 1 if computedHash > sibling (unsigned comparison).
                let swap := gt(computedHash, sibling)

                // Compute hash with computedHash on the left (normal order).
                mstore(0x00, computedHash)
                mstore(0x20, sibling)
                let hashNormal := keccak256(0x00, 0x40)

                // Compute hash with sibling on the left (swapped order).
                mstore(0x00, sibling)
                mstore(0x20, computedHash)
                let hashSwapped := keccak256(0x00, 0x40)

                // Select based on swap flag:
                // When swap == 1, use hashSwapped (sibling on left).
                // When swap == 0, use hashNormal (computedHash on left).
                computedHash := add(
                    mul(swap, hashSwapped),
                    mul(sub(1, swap), hashNormal)
                )

                // Store result back to scratch memory for next iteration.
                mstore(0x00, computedHash)
            }
        }

        return computedHash == root;
    }

    /// @notice Verifies a Merkle proof with explicit left/right ordering.
    /// @dev Uses only scratch memory (0x00–0x40) for intermediate hashes.
    ///      No dynamic memory allocation occurs. The caller must provide
    ///      proof elements in the correct left-to-right order.
    /// @param root The expected Merkle root.
    /// @param leaf The leaf value to verify.
    /// @param proof The array of sibling proof elements in order from leaf to root.
    /// @return True if the proof is valid, false otherwise.
    function verifyProofOrdered(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external pure returns (bool) {
        if (proof.length == 0) {
            return leaf == root;
        }

        if (proof.length > 256) {
            revert InvalidProofLength();
        }

        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];

            assembly {
                // [computedHash, sibling] -> [hash]
                // Always place computedHash on the left, sibling on the right.
                mstore(0x00, computedHash)
                mstore(0x20, sibling)
                computedHash := keccak256(0x00, 0x40)
            }
        }

        return computedHash == root;
    }
}