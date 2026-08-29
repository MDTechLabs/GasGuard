import { estimateCpuCost } from '../cpu-cost-estimator';

describe('CpuCostEstimator (#808)', () => {
  it('flags unbounded loops with high CPU weight', () => {
    const source = `
      pub fn process(env: Env, items: Vec<Address>) {
          for item in items.iter() {
              env.storage().persistent().set(&item, &1);
          }
      }
    `;
    const report = estimateCpuCost(source);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.some(
        (f) =>
          f.patternId === 'unbounded-loop' ||
          f.patternId === 'map-iteration' ||
          f.patternId === 'storage-in-loop',
      ),
    ).toBe(true);
    expect(report.totalEstimatedCpu).toBeGreaterThan(0);
  });

  it('ranks expensive patterns by aggregate cost', () => {
    const source = `
      fn heavy(env: Env) {
          for i in 0..n {
              for j in 0..m {
                  let _ = sha256(&data);
              }
          }
          env.invoke_contract(&addr, &fn_name, &args);
      }
    `;
    const report = estimateCpuCost(source);
    expect(report.rankedPatterns.length).toBeGreaterThan(0);
    // Ranked descending
    for (let i = 1; i < report.rankedPatterns.length; i++) {
      expect(report.rankedPatterns[i - 1].totalEstimatedCpu).toBeGreaterThanOrEqual(
        report.rankedPatterns[i].totalEstimatedCpu,
      );
    }
  });

  it('includes estimatedCpuCost on each finding', () => {
    const source = `fn f() { let _ = format!("x={}", 1); }`;
    const report = estimateCpuCost(source);
    for (const f of report.findings) {
      expect(f.estimatedCpuCost).toBeGreaterThan(0);
      expect(f.ruleId.startsWith('soroban-cpu-')).toBe(true);
    }
  });

  it('returns a clean summary when no patterns match', () => {
    const source = `pub fn noop() {}`;
    const report = estimateCpuCost(source);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/no high-cpu patterns/i);
  });
});
