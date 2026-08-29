// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title YulMathLib
/// @notice Zero-overhead fixed-point math library written in pure Yul assembly.
/// @dev Bypasses Solidity compiler overhead for safety checks and pointer conversions.
///      All operations use inline assembly for minimal gas cost.
library YulMathLib {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant HALF_WAD = 5e17;
    uint256 internal constant HALF_RAY = 5e26;
    uint256 internal constant MAX_UINT256 = type(uint256).max;

    error DivisionByZero();
    error Overflow();
    error Underflow();

    /// @notice Multiply two WAD-fixed-point numbers and divide by denominator.
    /// @dev mulDivDown(x, y, denominator) = (x * y) / denominator, all in 1e18 fixed-point.
    /// @param x First operand (WAD-scaled).
    /// @param y Second operand (WAD-scaled).
    /// @param denominator The divisor.
    /// @return result The result of (x * y) / denominator.
    function mulDivDown(
        uint256 x,
        uint256 y,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        assembly {
            if iszero(denominator) {
                revert(0, 0) // DivisionByZero
            }
            // Check for overflow: if x != 0 && y != 0 && x * y / x != y
            if and(iszero(iszero(x)), iszero(iszero(y))) {
                let prod := mul(x, y)
                if iszero(iszero(div(prod, x))) {
                    if iszero(eq(div(prod, x), y)) {
                        revert(0, 0) // Overflow
                    }
                }
            }
            result := div(mul(x, y), denominator)
        }
    }

    /// @notice Multiply two WAD-fixed-point numbers and divide by denominator, rounding up.
    /// @param x First operand (WAD-scaled).
    /// @param y Second operand (WAD-scaled).
    /// @param denominator The divisor.
    /// @return result The result of ceil((x * y) / denominator).
    function mulDivUp(
        uint256 x,
        uint256 y,
        uint256 denominator
    ) internal pure returns (uint256 result) {
        assembly {
            if iszero(denominator) {
                revert(0, 0)
            }
            result := div(mul(x, y), denominator)
            // Add 1 if there's a remainder
            if mulmod(x, y, denominator) {
                result := add(result, 1)
            }
        }
    }

    /// @notice WAD multiplication: (x * y) / WAD.
    /// @param x First operand.
    /// @param y Second operand.
    /// @return result The WAD-scaled product.
    function wadMul(uint256 x, uint256 y) internal pure returns (uint256 result) {
        assembly {
            if iszero(iszero(x)) {
                if iszero(iszero(y)) {
                    let prod := mul(x, y)
                    if iszero(eq(div(prod, x), y)) {
                        revert(0, 0)
                    }
                }
            }
            result := div(mul(x, y), WAD)
        }
    }

    /// @notice WAD division: (x * WAD) / y.
    /// @param x Numerator.
    /// @param y Denominator.
    /// @return result The WAD-scaled quotient.
    function wadDiv(uint256 x, uint256 y) internal pure returns (uint256 result) {
        assembly {
            if iszero(y) {
                revert(0, 0)
            }
            result := div(mul(x, WAD), y)
        }
    }

    /// @notice RAY multiplication: (x * y) / RAY.
    function rayMul(uint256 x, uint256 y) internal pure returns (uint256 result) {
        assembly {
            if iszero(iszero(x)) {
                if iszero(iszero(y)) {
                    let prod := mul(x, y)
                    if iszero(eq(div(prod, x), y)) {
                        revert(0, 0)
                    }
                }
            }
            result := div(mul(x, y), RAY)
        }
    }

    /// @notice RAY division: (x * RAY) / y.
    function rayDiv(uint256 x, uint256 y) internal pure returns (uint256 result) {
        assembly {
            if iszero(y) {
                revert(0, 0)
            }
            result := div(mul(x, RAY), y)
        }
    }

    /// @notice Convert from RAY to WAD (divide by 1e9).
    function rayToWad(uint256 x) internal pure returns (uint256 result) {
        assembly {
            result := div(x, 1e9)
        }
    }

    /// @notice Convert from WAD to RAY (multiply by 1e9).
    function wadToRay(uint256 x) internal pure returns (uint256 result) {
        assembly {
            // Check overflow
            if and(iszero(iszero(x)), gt(x, div(MAX_UINT256, 1e9))) {
                revert(0, 0)
            }
            result := mul(x, 1e9)
        }
    }

    /// @notice Minimum of two uint256 values.
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        assembly {
            let result := a
            if lt(b, a) {
                result := b
            }
            return (0, result)
        }
    }

    /// @notice Maximum of two uint256 values.
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        assembly {
            let result := a
            if gt(b, a) {
                result := b
            }
            return (0, result)
        }
    }

    /// @notice Absolute difference between two uint256 values.
    function absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        assembly {
            let result := sub(a, b)
            if gt(b, a) {
                result := sub(b, a)
            }
            return (0, result)
        }
    }
}

/// @title YulMathLibConsumer
/// @notice Example contract demonstrating zero-overhead Yul math operations.
contract YulMathLibConsumer {
    using YulMathLib for uint256;

    uint256 public constant PRECISION = 1e18;

    event CalculationResult(string operation, uint256 input1, uint256 input2, uint256 result);

    /// @notice Calculate percentage of amount using WAD math.
    /// @param amount The base amount.
    /// @param percentage The percentage in WAD (1e18 = 100%).
    /// @return The percentage of amount.
    function percentageOf(uint256 amount, uint256 percentage) external pure returns (uint256) {
        return amount.wadMul(percentage);
    }

    /// @notice Calculate compound interest.
    /// @param principal The initial principal.
    /// @param rate The annual interest rate in WAD.
    /// @param periods The number of compounding periods.
    /// @return The final amount after compounding.
    function compoundInterest(
        uint256 principal,
        uint256 rate,
        uint256 periods
    ) external pure returns (uint256) {
        uint256 amount = principal;
        for (uint256 i = 0; i < periods; i++) {
            amount = amount.wadMul(YulMathLib.WAD + rate);
        }
        return amount;
    }

    /// @notice Safe add with overflow check.
    function safeAdd(uint256 a, uint256 b) external pure returns (uint256) {
        assembly {
            let result := add(a, b)
            if lt(result, a) {
                revert(0, 0)
            }
            return (0, result)
        }
    }
}
