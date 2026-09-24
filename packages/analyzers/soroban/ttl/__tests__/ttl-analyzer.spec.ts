import {
  SorobanTtlAnalyzer,
  analyzeShortTtlValues,
  analyzeTtl,
  detectTtlOperations,
  describeLedgers,
  parseLedgerLiteral,
  SOROBAN_ABSOLUTE_MIN_TTL_LEDGERS,
  SOROBAN_RECOMMENDED_MIN_TTL_LEDGERS,
} from '../ttl-analyzer';

const CONTRACT = `
pub fn write_config(env: Env, value: u32) {
    env.storage().persistent().set(&DataKey::Config, &value);
}

pub fn write_session(env: Env, session: Symbol) {
    env.storage().persistent().set(&session, &1u32);
}

pub fn cache_temp(env: Env, user: Address) {
    env.storage().temporary().set(&user, &1u32);
}

pub fn healthy_bump(env: Env) {
    env.storage().persistent().set(&DataKey::Good, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Good, 17_280, 518_400);
}

pub fn short_bump(env: Env) {
    env.storage().persistent().set(&DataKey::Short, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Short, 1_000, 10_000);
}

pub fn medium_bump(env: Env) {
    env.storage().persistent().set(&DataKey::Medium, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Medium, 17_280, 400_000);
}

pub fn inverted(env: Env) {
    env.storage().persistent().set(&DataKey::Inverted, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Inverted, 500_000, 400_000);
}
`;

describe('Soroban TTL analyzer (#885)', () => {
  describe('parseLedgerLiteral', () => {
    it('parses underscored literals', () => {
      expect(parseLedgerLiteral('518_400')).toBe(518_400);
    });

    it('parses numeric type suffixes', () => {
      expect(parseLedgerLiteral('17_280u32')).toBe(17_280);
      expect(parseLedgerLiteral('100i64')).toBe(100);
    });

    it('evaluates simple products of literals', () => {
      expect(parseLedgerLiteral('30 * 24 * 12')).toBe(8_640);
    });

    it('returns null for named constants it cannot evaluate', () => {
      expect(parseLedgerLiteral('MAX_TTL')).toBeNull();
      expect(parseLedgerLiteral('')).toBeNull();
    });
  });

  describe('describeLedgers', () => {
    it('describes day-scale and minute-scale spans', () => {
      expect(describeLedgers(SOROBAN_ABSOLUTE_MIN_TTL_LEDGERS)).toContain('days');
      expect(describeLedgers(12)).toContain('minutes');
    });
  });

  describe('detectTtlOperations', () => {
    it('detects writes and extensions with their storage tier', () => {
      const operations = detectTtlOperations(CONTRACT);

      const writes = operations.filter((op) => op.kind === 'write');
      const extensions = operations.filter((op) => op.kind === 'extend_ttl');

      expect(writes).toHaveLength(7);
      expect(extensions).toHaveLength(4);

      const tempWrite = writes.find((op) => op.key === 'user');
      expect(tempWrite?.tier).toBe('temporary');

      const persistentWrite = writes.find((op) => op.key === 'DataKey::Config');
      expect(persistentWrite?.tier).toBe('persistent');
      expect(persistentWrite?.functionName).toBe('write_config');
    });

    it('captures the threshold and extend_to arguments of an extension', () => {
      const extension = detectTtlOperations(CONTRACT).find(
        (op) => op.kind === 'extend_ttl' && op.key === 'DataKey::Good',
      );

      expect(extension).toBeDefined();
      expect(extension?.thresholdArg).toBe('17_280');
      expect(extension?.extendToArg).toBe('518_400');
      expect(extension?.inLoop).toBe(false);
    });

    it('flags extensions performed inside loops', () => {
      const operations = detectTtlOperations(`
pub fn looped(env: Env, users: Vec<Address>) {
    for user in users.iter() {
        env.storage().persistent().extend_ttl(&user, 17_280, 518_400);
    }
}
`);
      const loopedExtension = operations.find((op) => op.kind === 'extend_ttl');
      expect(loopedExtension?.inLoop).toBe(true);
    });
  });

  describe('analyzeShortTtlValues', () => {
    it('does not flag a well-sized extension', () => {
      const findings = analyzeShortTtlValues(
        `pub fn ok(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, 17_280, 518_400);
}`,
      );
      expect(findings).toHaveLength(0);
    });

    it('flags an extend_to below the one-day floor as high severity', () => {
      const findings = analyzeShortTtlValues(
        `pub fn short(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, 1_000, 10_000);
}`,
      );
      const finding = findings.find((f) => f.kind === 'short_extend_ttl');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.key).toBe('Key::A');
      expect(finding?.message).toContain('10000');
      expect(finding?.recommendation).toContain(String(SOROBAN_RECOMMENDED_MIN_TTL_LEDGERS));
    });

    it('flags an extend_to below the 30-day recommendation as medium severity', () => {
      const findings = analyzeShortTtlValues(
        `pub fn medium(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, 17_280, 400_000);
}`,
      );
      const finding = findings.find((f) => f.kind === 'short_extend_ttl');
      expect(finding?.severity).toBe('medium');
    });

    it('flags threshold >= extend_to as an ineffective range', () => {
      const findings = analyzeShortTtlValues(
        `pub fn inverted(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, 500_000, 400_000);
}`,
      );
      const finding = findings.find((f) => f.kind === 'invalid_extension_range');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.message).toMatch(/never raises/i);
    });

    it('flags a missing extend_to argument', () => {
      const findings = analyzeShortTtlValues(
        `pub fn malformed(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, 17_280);
}`,
      );
      const finding = findings.find((f) => f.kind === 'invalid_extension_range');
      expect(finding).toBeDefined();
      expect(finding?.message).toMatch(/omits the extend_to/i);
    });

    it('skips values it cannot evaluate (named constants)', () => {
      const findings = analyzeShortTtlValues(
        `pub fn consts(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, MIN_THRESHOLD, MAX_TTL);
}`,
      );
      expect(findings).toHaveLength(0);
    });

    it('honours custom thresholds', () => {
      const findings = analyzeShortTtlValues(
        `pub fn custom(env: Env) {
    env.storage().persistent().extend_ttl(&Key::A, 1, 500);
}`,
        { recommendedMinLedgers: 1_000, absoluteMinLedgers: 100 },
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('medium');
    });
  });

  describe('SorobanTtlAnalyzer', () => {
    it('produces an aggregate report across all finding kinds', () => {
      const result = new SorobanTtlAnalyzer().analyze(CONTRACT);

      const kinds = new Set(result.findings.map((f) => f.kind));
      expect(kinds.has('missing_extension')).toBe(true);
      expect(kinds.has('short_extend_ttl')).toBe(true);
      expect(kinds.has('invalid_extension_range')).toBe(true);

      // Two persistent writes without extension, three short TTLs and one
      // ineffective range.
      expect(result.findings).toHaveLength(6);
    });

    it('reports missing extensions for persistent entries only', () => {
      const result = new SorobanTtlAnalyzer().analyze(CONTRACT);
      const missingKeys = result.findings
        .filter((f) => f.kind === 'missing_extension')
        .map((f) => f.key);

      expect(missingKeys).toContain('DataKey::Config');
      expect(missingKeys).toContain('session');
      expect(missingKeys).not.toContain('user');
    });

    it('fills metrics from the combined analysis', () => {
      const { metrics } = new SorobanTtlAnalyzer().analyze(CONTRACT);

      expect(metrics.totalOperations).toBe(11);
      expect(metrics.writes).toBe(7);
      expect(metrics.extensions).toBe(4);
      expect(metrics.persistentEntries).toBe(6);
      expect(metrics.extendedEntries).toBe(4);
      expect(metrics.unextendedEntries).toBe(2);
      expect(metrics.shortTtlValues).toBe(3);
      expect(metrics.invalidRanges).toBe(1);
    });

    it('counts extensions performed inside loops', () => {
      const { metrics } = new SorobanTtlAnalyzer().analyze(`
pub fn looped(env: Env, users: Vec<Address>) {
    for user in users.iter() {
        env.storage().persistent().extend_ttl(&user, 17_280, 518_400);
    }
}
`);
      expect(metrics.extensionsInLoops).toBe(1);
    });

    it('is clean and reassuring for a well-formed contract', () => {
      const result = new SorobanTtlAnalyzer().analyze(`
pub fn healthy(env: Env) {
    env.storage().persistent().set(&DataKey::X, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::X, 17_280, 518_400);
}
`);
      expect(result.findings).toHaveLength(0);
      expect(result.summary).toMatch(/No TTL risks detected/i);
    });

    it('does not treat comments or strings as real calls', () => {
      const result = new SorobanTtlAnalyzer().analyze(`
// env.storage().persistent().extend_ttl(&Key::Fake, 1, 2);
pub fn real(env: Env) {
    let s = "env.storage().persistent().set(&Key::Fake, &1u32)";
    env.storage().persistent().set(&DataKey::Real, &1u32);
    env.storage().persistent().extend_ttl(&DataKey::Real, 17_280, 518_400);
}
`);
      expect(result.findings).toHaveLength(0);
      expect(result.metrics.persistentEntries).toBe(1);
    });

    it('is exposed through the analyzeTtl wrapper', () => {
      expect(analyzeTtl(CONTRACT).findings).toHaveLength(6);
    });
  });
});
