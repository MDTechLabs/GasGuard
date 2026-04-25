import { BadRequestException } from '@nestjs/common';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Validates that a value is a finite, non-NaN number.
 */
function assertFinite(value: number, label = 'value'): void {
  if (!Number.isFinite(value)) {
    throw new BadRequestException(`SafeMath: ${label} must be a finite number, got ${value}`);
  }
}

/**
 * Validates that a BigInt result stays within safe integer bounds.
 */
function assertBounds(result: bigint, operation: string): number {
  if (result > MAX_SAFE || result < MIN_SAFE) {
    throw new BadRequestException(
      `SafeMath: ${operation} result (${result}) exceeds safe integer bounds`,
    );
  }
  return Number(result);
}

export class SafeMath {
  /**
   * Safe addition — throws on overflow.
   */
  static add(a: number, b: number): number {
    assertFinite(a, 'a');
    assertFinite(b, 'b');
    return assertBounds(BigInt(Math.trunc(a)) + BigInt(Math.trunc(b)), 'add');
  }

  /**
   * Safe subtraction — throws on underflow.
   */
  static sub(a: number, b: number): number {
    assertFinite(a, 'a');
    assertFinite(b, 'b');
    return assertBounds(BigInt(Math.trunc(a)) - BigInt(Math.trunc(b)), 'sub');
  }

  /**
   * Safe multiplication — throws on overflow.
   */
  static mul(a: number, b: number): number {
    assertFinite(a, 'a');
    assertFinite(b, 'b');
    return assertBounds(BigInt(Math.trunc(a)) * BigInt(Math.trunc(b)), 'mul');
  }

  /**
   * Safe division — throws on division by zero.
   */
  static div(a: number, b: number): number {
    assertFinite(a, 'a');
    assertFinite(b, 'b');
    if (b === 0) {
      throw new BadRequestException('SafeMath: division by zero');
    }
    return a / b;
  }

  /**
   * Safe non-negative check — throws if value would go below zero.
   */
  static subNonNegative(a: number, b: number): number {
    assertFinite(a, 'a');
    assertFinite(b, 'b');
    if (b > a) {
      throw new BadRequestException(
        `SafeMath: subtraction would underflow (${a} - ${b} < 0)`,
      );
    }
    return a - b;
  }

  /**
   * Safe percentage calculation — returns (value * pct) / 100.
   */
  static percentage(value: number, pct: number): number {
    assertFinite(value, 'value');
    assertFinite(pct, 'pct');
    if (pct < 0 || pct > 100) {
      throw new BadRequestException(
        `SafeMath: percentage must be between 0 and 100, got ${pct}`,
      );
    }
    return (value * pct) / 100;
  }

  /**
   * Safe fee calculation — value * feeRate where feeRate is 0–1.
   */
  static applyFee(value: number, feeRate: number): number {
    assertFinite(value, 'value');
    assertFinite(feeRate, 'feeRate');
    if (feeRate < 0 || feeRate > 1) {
      throw new BadRequestException(
        `SafeMath: feeRate must be between 0 and 1, got ${feeRate}`,
      );
    }
    return value * feeRate;
  }
}
