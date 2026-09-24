import {
  analyzeEventPayloadSizes,
  DEFAULT_MAX_EVENT_PAYLOAD_SIZE,
} from '../event-payload-size-analyzer';

describe('Event Payload Size Analyzer (#915)', () => {
  const SMALL = `
    pub fn transfer(env: Env, from: Address, to: Address) {
        env.events().publish((symbol_short!("transfer"), from), to);
    }
  `;

  const LARGE_STRUCT = `
    pub fn register(env: Env, user: Address) {
        env.events().publish((symbol_short!("register"), user), UserProfile { name, email, phone, address, age, balance });
    }
  `;

  const LARGE_TEXT = `
    pub fn log(env: Env, user: Address) {
        env.events().publish((symbol_short!("log"), user), "this is a very long payload string that keeps going well beyond the normal budget for event data and should be flagged as oversized because it repeats and repeats and repeats and repeats and repeats and repeats and repeats");
    }
  `;

  const CLEAN = `
    pub fn ping(env: Env) {
        env.events().publish((symbol_short!("ping"),), 1);
    }
  `;

  test('estimates payload size for each emission', () => {
    const report = analyzeEventPayloadSizes(SMALL);
    expect(report.payloads).toHaveLength(1);
    expect(report.payloads[0].estimatedSize).toBeGreaterThan(0);
    expect(report.payloads[0].topics).toMatch(/transfer/);
  });

  test('detects large struct payloads', () => {
    const report = analyzeEventPayloadSizes(LARGE_STRUCT);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.findings[0].message).toMatch(/Oversized event payload/);
  });

  test('detects large text payloads', () => {
    const report = analyzeEventPayloadSizes(LARGE_TEXT);
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
  });

  test('reports source locations', () => {
    const report = analyzeEventPayloadSizes(LARGE_STRUCT);
    expect(report.findings[0].line).toBeGreaterThan(0);
    expect(report.findings[0].functionName).toBe('register');
  });

  test('generates optimization guidance', () => {
    const report = analyzeEventPayloadSizes(LARGE_STRUCT);
    expect(report.findings[0].suggestion).toMatch(/compact|smaller/i);
  });

  test('reports clean summary when payloads are small', () => {
    const report = analyzeEventPayloadSizes(CLEAN);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/No oversized/);
  });

  test('respects custom threshold', () => {
    const strict = analyzeEventPayloadSizes(SMALL, { maxSize: 1, maxFields: 1 });
    expect(strict.findings.length).toBeGreaterThanOrEqual(1);

    const relaxed = analyzeEventPayloadSizes(SMALL, {
      maxSize: DEFAULT_MAX_EVENT_PAYLOAD_SIZE * 100,
      maxFields: 100,
    });
    expect(relaxed.findings).toHaveLength(0);
  });
});
