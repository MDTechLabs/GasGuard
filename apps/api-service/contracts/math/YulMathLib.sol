// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title YulMathLib
/// @notice Zero-overhead fixed-point `mulDiv` implemented entirely in Yul.
/// @dev `floor(x * y / denominator)` cannot be computed as `(x * y) / denominator`
///      in plain Solidity whenever `x * y` exceeds `type(uint256).max` — the
///      multiplication reverts (checked arithmetic) or silently wraps
///      (unchecked), long before the division ever runs. This library instead
///      computes the exact, non-overflowing 512-bit product `x * y` as a pair
///      of 256-bit words `[prod1:prod0]` and then divides that 512-bit value
///      by `denominator`, so the *true* mathematical result is produced even
///      when `x * y > type(uint256).max`, as long as the final quotient still
///      fits back into 256 bits.
///
///      The 512-bit-safe division technique used below (isolate the
///      denominator's power-of-two factor, then invert the odd remainder
///      modulo 2**256 via Newton-Raphson) is the same one popularized by
///      Remco Bloemen and used, in spirit, by Uniswap's `FullMath.mulDiv` and
///      OpenZeppelin's `Math.mulDiv`. It is re-derived and hand-written here
///      in raw Yul rather than copied, per the task's requirement.
library YulMathLib {
    /// @notice Thrown when `denominator` is zero.
    error DivisionByZero();

    /// @notice Thrown when the true mathematical result of `x * y / denominator`
    ///         does not fit into 256 bits (i.e. `denominator` is too small
    ///         relative to the 512-bit product `x * y`).
    error MulDivOverflow();

    /// @notice Computes `floor(x * y / denominator)`.
    /// @dev Entirely implemented in Yul. High level structure:
    ///      1. Compute the exact 512-bit product `[prod1:prod0] = x * y` using
    ///         `mulmod(x, y, not(0))` (product mod 2**256 - 1) combined with
    ///         `mul(x, y)` (product mod 2**256, i.e. the low word) — the
    ///         Chinese Remainder Theorem then gives the exact high word
    ///         `prod1` without ever needing more than 256 bits of scratch
    ///         space at once.
    ///      2. Fast path: if `prod1 == 0` the product fit in 256 bits, so a
    ///         plain `div` (which is floor division for the EVM's unsigned
    ///         integers) is the correct and final answer.
    ///      3. Slow path: if `prod1 != 0`, first require `denominator > prod1`
    ///         — this is both the overflow check (the final quotient is
    ///         `prod1_bits`-bounded only if the top word is strictly smaller
    ///         than the denominator) and guarantees `denominator != 0`. Then
    ///         perform the standard 512-by-256 division: subtract the exact
    ///         remainder to make `[prod1:prod0]` a clean multiple of
    ///         `denominator`, factor out `denominator`'s powers of two so it
    ///         becomes odd, compute the modular inverse of the odd part
    ///         modulo 2**256 via Newton-Raphson (doubling correct bits each
    ///         iteration: 4 -> 8 -> 16 -> 32 -> 64 -> 128 -> 256), and finish
    ///         with a single multiplication.
    function mulDivDown(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        // Custom error selectors are pulled into locals here because
        // `<Error>.selector` cannot be referenced directly as an assembly
        // identifier (Solidity only allows `.selector`/`.slot`/`.offset` on
        // variables inside assembly, not on error/type members) — going
        // through a `bytes4` local is the verified-correct way to get the
        // selector's 4 bytes left-aligned in memory for `revert`.
        bytes4 divisionByZeroSelector = DivisionByZero.selector;
        bytes4 mulDivOverflowSelector = MulDivOverflow.selector;

        assembly {
            // ------------------------------------------------------------
            // Step 1: exact 512-bit product x * y = [prod1:prod0].
            // ------------------------------------------------------------
            // `mul` silently wraps mod 2**256 -> this is the low word.
            let prod0 := mul(x, y)
            // `mulmod` with modulus `not(0)` (2**256 - 1) uses the EVM's
            // internal 512-bit intermediate, so it never overflows and
            // gives us (x * y) mod (2**256 - 1) exactly.
            let mm := mulmod(x, y, not(0))
            // CRT reconstruction of the high word: prod1 = mm - prod0 - (1 if mm < prod0 else 0),
            // all mod 2**256 (the `sub`s wrap correctly on the EVM).
            let prod1 := sub(sub(mm, prod0), lt(mm, prod0))

            if iszero(denominator) {
                mstore(0x00, divisionByZeroSelector)
                revert(0x00, 0x04)
            }

            // ------------------------------------------------------------
            // Step 2: fast path — product fits in 256 bits.
            // ------------------------------------------------------------
            if iszero(prod1) {
                result := div(prod0, denominator)
            }

            // ------------------------------------------------------------
            // Step 3: slow path — 512-bit product, 512-by-256 division.
            // ------------------------------------------------------------
            if prod1 {
                // The final quotient only fits in 256 bits if the high word
                // of the product is strictly smaller than the denominator;
                // this simultaneously rules out denominator == 0 (already
                // handled above, but kept implicit here for the algorithm).
                if iszero(gt(denominator, prod1)) {
                    mstore(0x00, mulDivOverflowSelector)
                    revert(0x00, 0x04)
                }

                // Make [prod1:prod0] an exact multiple of denominator by
                // subtracting the true remainder (computed via mulmod, so
                // this is exact even though x*y itself overflows 256 bits).
                let remainder := mulmod(x, y, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)

                // Factor denominator = twos * odd, where `twos` is the
                // largest power of two dividing denominator. Isolating the
                // lowest set bit of a two's-complement number gives exactly
                // that power of two: twos = denominator & (-denominator).
                let twos := and(denominator, sub(0, denominator))
                denominator := div(denominator, twos)

                // Divide prod0 by the same power of two, then shift in the
                // bits that `prod1` contributes once it's rescaled by
                // `2**256 / twos` (computed as ((0 - twos) / twos) + 1,
                // which also correctly yields 1 when twos == 1, i.e. when
                // denominator was already odd and no shifting is needed).
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
                prod0 := or(prod0, mul(prod1, twos))

                // `denominator` is now odd, so it has a modular inverse mod
                // 2**256. Seed a 4-bit-correct inverse (3 * d XOR 2 is
                // correct mod 2**4 for any odd d), then double the number of
                // correct bits on each Newton-Raphson step: 4->8->16->32->
                // 64->128->256.
                let inv := xor(mul(3, denominator), 2)
                inv := mul(inv, sub(2, mul(denominator, inv))) // mod 2**8
                inv := mul(inv, sub(2, mul(denominator, inv))) // mod 2**16
                inv := mul(inv, sub(2, mul(denominator, inv))) // mod 2**32
                inv := mul(inv, sub(2, mul(denominator, inv))) // mod 2**64
                inv := mul(inv, sub(2, mul(denominator, inv))) // mod 2**128
                inv := mul(inv, sub(2, mul(denominator, inv))) // mod 2**256

                // Since division is now exact, multiplying by the modular
                // inverse recovers the true quotient mod 2**256 — and the
                // overflow check above already guarantees it fits.
                result := mul(prod0, inv)
            }
        }
    }
}
