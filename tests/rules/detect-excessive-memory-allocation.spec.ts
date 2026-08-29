import { detectExcessiveMemoryAllocation } from '../../rules/optimization/memory/detect-excessive-memory-allocation';

describe('detectExcessiveMemoryAllocation', () => {
  it('detects large array allocations', () => {
    const code = 'let arr = [0; 1000];';
    const result = detectExcessiveMemoryAllocation(code);
    expect(result.detected).toBe(true);
    expect(result.allocations[0]).toBe('[0; 1000]');
  });

  it('detects large Vec capacity allocations', () => {
    const code = 'let v: Vec<u8> = Vec::with_capacity(5000);';
    const result = detectExcessiveMemoryAllocation(code);
    expect(result.detected).toBe(true);
    expect(result.allocations[0]).toBe('Vec::with_capacity(5000)');
  });

  it('detects large vec! macro allocations', () => {
    const code = 'let v = vec![0; 2000];';
    const result = detectExcessiveMemoryAllocation(code);
    expect(result.detected).toBe(true);
    expect(result.allocations[0]).toBe('vec![0; 2000]');
  });

  it('does not flag small array allocations', () => {
    const code = 'let arr = [0; 100];';
    const result = detectExcessiveMemoryAllocation(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag small Vec capacity allocations', () => {
    const code = 'let v: Vec<u8> = Vec::with_capacity(500);';
    const result = detectExcessiveMemoryAllocation(code);
    expect(result.detected).toBe(false);
  });

  it('does not flag small vec! macro allocations', () => {
    const code = 'let v = vec![0; 200];';
    const result = detectExcessiveMemoryAllocation(code);
    expect(result.detected).toBe(false);
  });
});
