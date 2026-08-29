/**
 * Soroban Analysis Profile Marketplace — Tests (Issue #484)
 */

import {
  AnalysisProfile,
  PROFILE_ENVELOPE_KIND,
  StellarProfileMarketplace,
  computeChecksum,
  exportProfile,
  exportProfileToJson,
  importProfile,
  isSchemaCompatible,
} from '../index';

function makeProfile(overrides: Partial<AnalysisProfile> = {}): AnalysisProfile {
  return {
    id: 'soroban-strict',
    name: 'Soroban Strict',
    description: 'Strict security scan configuration for Soroban contracts',
    target: 'stellar-soroban',
    tags: ['security', 'strict'],
    rules: [
      { id: 'SOR-001', enabled: true, severity: 'high', category: 'reentrancy' },
      { id: 'SOR-002', enabled: true, severity: 'critical', category: 'auth' },
    ],
    ...overrides,
  };
}

describe('schema compatibility', () => {
  it('accepts the same major version', () => {
    expect(isSchemaCompatible('1.0.0')).toBe(true);
    expect(isSchemaCompatible('1.4.2')).toBe(true);
  });

  it('rejects a different major version or garbage', () => {
    expect(isSchemaCompatible('2.0.0')).toBe(false);
    expect(isSchemaCompatible('not-a-version')).toBe(false);
  });
});

describe('export', () => {
  it('wraps a profile in a self-describing envelope with a checksum', () => {
    const profile = makeProfile();
    const env = exportProfile(profile, { author: { name: 'team-sec' } });

    expect(env.kind).toBe(PROFILE_ENVELOPE_KIND);
    expect(env.schemaVersion).toBe('1.0.0');
    expect(env.profile).toEqual(profile);
    expect(env.metadata.author).toEqual({ name: 'team-sec' });
    expect(env.metadata.checksum).toBe(computeChecksum(profile));
    expect(new Date(env.metadata.exportedAt).toString()).not.toBe('Invalid Date');
  });

  it('produces an order-independent, stable checksum', () => {
    const a = makeProfile({ tags: ['security', 'strict'] });
    // Same data, different key insertion order.
    const b: AnalysisProfile = {
      rules: a.rules,
      tags: ['security', 'strict'],
      target: 'stellar-soroban',
      description: a.description,
      name: a.name,
      id: a.id,
    };
    expect(computeChecksum(a)).toBe(computeChecksum(b));
  });
});

describe('import (round-trip)', () => {
  it('imports a freshly exported profile', () => {
    const profile = makeProfile();
    const json = exportProfileToJson(profile);

    const result = importProfile(json);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.profile).toEqual(profile);
  });

  it('accepts an already-parsed envelope object', () => {
    const env = exportProfile(makeProfile());
    const result = importProfile(env);
    expect(result.ok).toBe(true);
  });
});

describe('import (rejection)', () => {
  it('rejects malformed JSON', () => {
    const result = importProfile('{ not valid json');
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_JSON');
  });

  it('rejects an artifact with the wrong kind', () => {
    const result = importProfile({ kind: 'something-else', schemaVersion: '1.0.0' });
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('KIND_INVALID');
  });

  it('rejects an incompatible schema version', () => {
    const env = exportProfile(makeProfile());
    const result = importProfile({ ...env, schemaVersion: '2.0.0' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'SCHEMA_INCOMPATIBLE')).toBe(true);
  });

  it('rejects a tampered profile (checksum mismatch)', () => {
    const env = exportProfile(makeProfile());
    // Mutate the profile after the checksum was computed.
    const tampered = {
      ...env,
      profile: { ...env.profile, name: 'Backdoored Profile' },
    };
    const result = importProfile(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'CHECKSUM_MISMATCH')).toBe(true);
  });

  it('reports structural validation errors', () => {
    const env = exportProfile(makeProfile());
    const broken = { ...env, profile: { ...env.profile, id: '', target: 'evm' } };
    const result = importProfile(broken);
    expect(result.ok).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('ID_REQUIRED');
    expect(codes).toContain('TARGET_INVALID');
  });

  it('warns (but succeeds) when no checksum is present', () => {
    const env = exportProfile(makeProfile());
    const noChecksum = {
      ...env,
      metadata: { ...env.metadata, checksum: '' },
    };
    const result = importProfile(noChecksum);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.code === 'CHECKSUM_MISSING')).toBe(true);
  });
});

describe('marketplace registry', () => {
  let market: StellarProfileMarketplace;

  beforeEach(() => {
    market = new StellarProfileMarketplace();
  });

  it('publishes, lists, and gets profiles', () => {
    market.publish(makeProfile());
    expect(market.size).toBe(1);
    expect(market.has('soroban-strict')).toBe(true);
    expect(market.get('soroban-strict')?.name).toBe('Soroban Strict');
    expect(market.list()).toHaveLength(1);
  });

  it('dedups on id (publishing the same id upserts)', () => {
    market.publish(makeProfile());
    market.publish(makeProfile({ name: 'Soroban Strict v2' }));
    expect(market.size).toBe(1);
    expect(market.get('soroban-strict')?.name).toBe('Soroban Strict v2');
  });

  it('imports a shared artifact and registers it', () => {
    const json = exportProfileToJson(makeProfile());
    const result = market.importFrom(json);
    expect(result.ok).toBe(true);
    expect(market.size).toBe(1);
  });

  it('does not register an invalid artifact', () => {
    const result = market.importFrom('{ bad');
    expect(result.ok).toBe(false);
    expect(market.size).toBe(0);
  });

  it('round-trips through export() from the registry', () => {
    market.publish(makeProfile());
    const env = market.export('soroban-strict', { author: { name: 'team-sec' } });
    const other = new StellarProfileMarketplace();
    expect(other.importFrom(env).ok).toBe(true);
    expect(other.get('soroban-strict')).toEqual(market.get('soroban-strict'));
  });

  it('throws when exporting an unknown profile', () => {
    expect(() => market.export('missing')).toThrow();
  });

  it('searches by text, tag, and category', () => {
    market.publish(makeProfile());
    market.publish(
      makeProfile({
        id: 'soroban-gas',
        name: 'Soroban Gas',
        description: 'Gas-focused checks',
        tags: ['performance'],
        rules: [{ id: 'SOR-100', enabled: true, severity: 'low', category: 'gas' }],
      }),
    );

    expect(market.search()).toHaveLength(2);
    expect(market.search({ text: 'gas-focused' }).map((p) => p.id)).toEqual(['soroban-gas']);
    expect(market.search({ tags: ['security'] }).map((p) => p.id)).toEqual(['soroban-strict']);
    expect(market.search({ category: 'gas' }).map((p) => p.id)).toEqual(['soroban-gas']);
    expect(market.search({ text: 'soroban', tags: ['performance'] }).map((p) => p.id)).toEqual([
      'soroban-gas',
    ]);
  });
});
