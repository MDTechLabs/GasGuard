import {
  analyzeCallFrequency,
  extractCallEdges,
  buildFrequencies,
  identifyHotPaths,
  generateFindings,
} from '../call-frequency-analyzer';

const SAMPLE = `
pub fn transfer(env: Env, to: Address, amount: i128) {
    self.require_auth();
    self.require_auth();
    self.require_auth();
    let bal = self.balance_of(to.clone());
    let bal2 = self.balance_of(to.clone());
    let bal3 = self.balance_of(to.clone());
    self.update_balance(to, amount);
    self.update_balance(to, amount);
    self.emit_transfer(to, amount);
}

fn helper_a() {
    self.inner_helper();
    self.inner_helper();
    self.inner_helper();
    self.inner_helper();
}
`;

describe('CallFrequencyAnalyzer (#802)', () => {
  it('extracts call edges with caller context', () => {
    const edges = extractCallEdges(SAMPLE);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.caller === 'transfer' && e.callee === 'require_auth')).toBe(true);
    expect(edges.some((e) => e.caller === 'transfer' && e.callee === 'balance_of')).toBe(true);
  });

  it('counts repeated calls per caller→callee edge', () => {
    const edges = extractCallEdges(SAMPLE);
    const freq = buildFrequencies(edges);
    const auth = freq.find((f) => f.caller === 'transfer' && f.callee === 'require_auth');
    expect(auth).toBeDefined();
    expect(auth!.count).toBeGreaterThanOrEqual(3);
  });

  it('identifies hot call paths', () => {
    const report = analyzeCallFrequency(SAMPLE);
    expect(report.hotPaths.length).toBeGreaterThan(0);
    expect(report.hotPaths[0].weight).toBeGreaterThanOrEqual(3);
  });

  it('generates optimization-candidate findings for frequent helpers', () => {
    const findings = generateFindings(buildFrequencies(extractCallEdges(SAMPLE)));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.ruleId === 'soroban-call-frequency')).toBe(true);
    expect(findings.some((f) => f.edge.count >= 3)).toBe(true);
  });

  it('full report includes metrics', () => {
    const report = analyzeCallFrequency(SAMPLE);
    expect(report.metrics.totalCallSites).toBeGreaterThan(0);
    expect(report.metrics.uniqueEdges).toBeGreaterThan(0);
    expect(report.metrics.maxFrequency).toBeGreaterThanOrEqual(3);
  });

  it('returns empty findings for source with no repeated helpers', () => {
    const clean = `
      pub fn once(env: Env) {
          self.setup();
      }
    `;
    const report = analyzeCallFrequency(clean);
    expect(report.findings).toHaveLength(0);
  });
});
