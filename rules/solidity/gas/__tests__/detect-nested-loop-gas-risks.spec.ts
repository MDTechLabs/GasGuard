/**
 * Issue #294 — Tests for the Nested Loop Gas Risk detector
 */

import { detectNestedLoopGasRisks } from '../detect-nested-loop-gas-risks';

describe('Nested Loop Gas Risk detector (#294)', () => {
  it('detects nested loop depth', () => {
    const code = `
contract Vault {
    function fold(uint[] memory xs, uint[] memory ys) external pure returns (uint) {
        uint total = 0;
        for (uint i = 0; i < xs.length; i++) {
            for (uint j = 0; j < ys.length; j++) {
                total += xs[i] * ys[j];
            }
        }
        return total;
    }
}
`;
    const result = detectNestedLoopGasRisks(code);
    expect(result.detected).toBe(true);
    expect(result.loops.length).toBe(2);
    expect(Math.max(...result.loops.map((l) => l.depth))).toBe(2);
  });

  it('estimates gas risk by depth', () => {
    const code = `
contract C {
    function f(uint n) external pure {
        for (uint i = 0; i < n; i++) {
            for (uint j = 0; j < n; j++) {
                for (uint k = 0; k < n; k++) {
                    sink += i * j * k;
                }
            }
        }
    }
}
`;
    const result = detectNestedLoopGasRisks(code);
    expect(result.detected).toBe(true);
    expect(result.message).toMatch(/depth 3/);
    expect(result.loops.some((l) => l.risk === 'high')).toBe(true);
  });

  it('does not flag flat loops', () => {
    const code = `
contract C {
    function sum(uint[] memory xs) external pure returns (uint) {
        uint total;
        for (uint i = 0; i < xs.length; i++) {
            total += xs[i];
        }
        while (total > 0) {
            total -= 1;
        }
        return total;
    }
}
`;
    const result = detectNestedLoopGasRisks(code);
    expect(result.detected).toBe(false);
    expect(result.message).toMatch(/No nested loop/i);
  });

  it('ignores loops inside comments and strings', () => {
    const code = `
contract C {
    // for (uint i = 0; i < n; i++) { for (uint j = 0; j < n; j++) {} }
    function f() external pure returns (string memory) {
        return "for (;;) { while (true) {} }";
    }
}
`;
    const result = detectNestedLoopGasRisks(code);
    expect(result.detected).toBe(false);
  });

  it('handles do-while without double counting', () => {
    const code = `
contract C {
    function f(uint n) external pure {
        do {
            for (uint j = 0; j < n; j++) {
                sink(j);
            }
        } while (j < 3);
    }
}
`;
    const result = detectNestedLoopGasRisks(code);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0].depth).toBe(2);
  });
});
