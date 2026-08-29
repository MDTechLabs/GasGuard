import { validateFixes, SafetyReport } from '../autofix-safety-validator';
import { FixInstruction } from '../../diff/optimization-diff-generator';

const SOURCE = [
  '#[contractimpl]',
  'impl MyContract {',
  '    pub fn transfer(env: Env, amount: i128) {',
  '        let x = 1 + 1;',
  '        let y = 2 + 2;',
  '    }',
  '}',
].join('\n');

describe('validateFixes', () => {
  it('accepts a safe, non-overlapping fix', () => {
    const fixes: FixInstruction[] = [
      { startLine: 4, endLine: 4, replacement: ['        let x = 2;'], description: 'constant fold' },
    ];
    const report: SafetyReport = validateFixes(SOURCE, fixes);
    expect(report.allSafe).toBe(true);
    expect(report.safeCount).toBe(1);
  });

  it('rejects an out-of-bounds fix', () => {
    const fixes: FixInstruction[] = [
      { startLine: 100, endLine: 105, replacement: [], description: 'oob' },
    ];
    const report = validateFixes(SOURCE, fixes);
    expect(report.allSafe).toBe(false);
    expect(report.rejectedCount).toBe(1);
  });

  it('rejects overlapping fixes', () => {
    const fixes: FixInstruction[] = [
      { startLine: 3, endLine: 5, replacement: ['    pub fn transfer() {}'], description: 'a' },
      { startLine: 4, endLine: 6, replacement: [], description: 'b' },
    ];
    const report = validateFixes(SOURCE, fixes);
    expect(report.rejectedCount).toBeGreaterThan(0);
  });

  it('rejects deletion of a contractimpl block', () => {
    const fixes: FixInstruction[] = [
      { startLine: 1, endLine: 1, replacement: [], description: 'delete contractimpl' },
    ];
    const report = validateFixes(SOURCE, fixes);
    expect(report.rejectedCount).toBe(1);
  });
});
