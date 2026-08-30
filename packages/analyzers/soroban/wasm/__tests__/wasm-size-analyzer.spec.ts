import { analyzeWasmSize, detectWasmSizeFindings } from '../wasm-size-analyzer';

function bytes(kib: number): Uint8Array {
  return new Uint8Array(kib * 1024);
}

describe('WasmSizeAnalyzer (#930)', () => {
  it('passes when an artifact is within the default budget', () => {
    const report = analyzeWasmSize(bytes(32));
    expect(report.withinBudget).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.sizeBytes).toBe(32 * 1024);
  });

  it('flags an artifact over the default 64 KiB warning threshold', () => {
    const report = analyzeWasmSize(bytes(70));
    expect(report.withinBudget).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].ruleId).toBe('soroban-wasm-size');
    expect(report.findings[0].severity).toBe('medium');
  });

  it('flags a critical severity above 128 KiB', () => {
    const findings = detectWasmSizeFindings(bytes(200));
    expect(findings[0].severity).toBe('high');
  });

  it('honours custom configurable thresholds', () => {
    const report = analyzeWasmSize(bytes(10), {
      warningThresholdBytes: 5 * 1024,
      criticalThresholdBytes: 8 * 1024,
      name: 'custom.wasm',
    });
    expect(report.name).toBe('custom.wasm');
    expect(report.withinBudget).toBe(false);
    expect(report.thresholdBytes).toBe(5 * 1024);
    // 10 KiB > 8 KiB critical threshold
    expect(report.findings[0].severity).toBe('high');
  });

  it('attaches metrics and a recommendation', () => {
    const report = analyzeWasmSize(bytes(65));
    expect(report.findings[0].metrics.sizeBytes).toBe(65 * 1024);
    expect(report.recommendation).toBeTruthy();
  });
});