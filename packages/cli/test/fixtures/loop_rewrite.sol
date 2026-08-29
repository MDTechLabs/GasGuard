// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Fixture exercising the unchecked-loop-counter rewriter's target
/// and non-target cases. See src/transformers/loop_unchecked.rs.
contract LoopRewriteFixture {
    uint256[] public items;

    /// Post-increment counter over an array length — the canonical target.
    function sumPostIncrement() external view returns (uint256 total) {
        for (uint256 i = 0; i < items.length; i++) {
            // running total
            total += items[i];
        }
    }

    /// Pre-increment counter — same shape, different operator.
    function sumPreIncrement() external view returns (uint256 total) {
        for (uint256 i = 0; i < items.length; ++i) {
            total += items[i];
        }
    }

    /// Compound-assignment increment — still a bounded +1 step.
    function sumCompoundAssign() external view returns (uint256 total) {
        for (uint256 i = 0; i < items.length; i += 1) {
            total += items[i];
        }
    }

    /// Bound against a fixed literal instead of .length — still bounded.
    function sumFixedBound(uint256[10] calldata values) external pure returns (uint256 total) {
        for (uint256 i = 0; i < 10; i++) {
            total += values[i];
        }
    }

    /// Nested loops — the rewriter must not confuse inner/outer braces.
    function sumNested(uint256[] calldata rows, uint256[] calldata cols)
        external
        pure
        returns (uint256 total)
    {
        for (uint256 i = 0; i < rows.length; i++) {
            for (uint256 j = 0; j < cols.length; j++) {
                total += rows[i] * cols[j];
            }
        }
    }

    /// Already unchecked — must be left alone (no double-wrapping).
    function sumAlreadyUnchecked() external view returns (uint256 total) {
        for (uint256 i = 0; i < items.length; ) {
            total += items[i];
            unchecked {
                ++i;
            }
        }
    }

    /// Decrementing counter — not a target; step direction differs.
    function sumDecrement(uint256 start) external view returns (uint256 total) {
        for (uint256 i = start; i > 0; i--) {
            total += items[i - 1];
        }
    }

    /// Step other than 1 — not the simple +1 bounded-counter pattern.
    function sumStepTwo() external view returns (uint256 total) {
        for (uint256 i = 0; i < items.length; i += 2) {
            total += items[i];
        }
    }

    /// While-style loop (empty init/increment clauses) — not a for-counter.
    function sumWhileStyle() external view returns (uint256 total) {
        uint256 i = 0;
        for (; i < items.length; ) {
            total += items[i];
            i++;
        }
    }
}
