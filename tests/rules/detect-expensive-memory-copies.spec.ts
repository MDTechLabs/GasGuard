import { detectExpensiveMemoryCopies } from '../../rules/optimization/memory/detect-expensive-memory-copies';

describe('detectExpensiveMemoryCopies', () => {
  it('flags unnecessary .clone() calls', () => {
    const code = `let copy = original.clone();`;
    const result = detectExpensiveMemoryCopies(code);
    expect(result.detected).toBe(true);
    expect(result.copies.some(c => c.type === 'unnecessary-clone')).toBe(true);
  });

  it('flags String::from conversions', () => {
    const code = `let s = String::from(name);`;
    const result = detectExpensiveMemoryCopies(code);
    expect(result.detected).toBe(true);
    expect(result.copies.some(c => c.type === 'string-to-string-copy')).toBe(true);
  });

  it('flags vec copy operations', () => {
    const code = `let all = items.to_vec();`;
    const result = detectExpensiveMemoryCopies(code);
    expect(result.detected).toBe(true);
    expect(result.copies.some(c => c.type === 'vec-copy')).toBe(true);
  });

  it('returns clean for reference usage', () => {
    const code = `fn process(data: &[u8]) -> u32 { data.len() as u32 }`;
    const result = detectExpensiveMemoryCopies(code);
    expect(result.detected).toBe(false);
  });
});
