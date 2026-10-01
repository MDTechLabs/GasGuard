/**
 * Unit tests for LogRedactionService
 *
 * Covers normal, boundary, and failure scenarios for secret redaction in
 * log messages and metadata. Part of the Security Hardening workstream
 * (issue #1102).
 */

import {
  LogRedactionService,
  REDACTED_MARKER,
  DEFAULT_REDACT_KEYS,
  DEFAULT_REDACT_VALUE_PATTERNS,
} from '../log-redaction';

describe('LogRedactionService', () => {
  // ─── Normal scenarios ───────────────────────────────────────────

  describe('defaults (secure by default)', () => {
    it('is enabled when constructed with no arguments', () => {
      const service = new LogRedactionService();
      expect(service.isEnabled()).toBe(true);
    });

    it('ships a non-empty default key list and value patterns', () => {
      const config = new LogRedactionService().getConfig();
      expect(config.redactKeys.length).toBeGreaterThanOrEqual(DEFAULT_REDACT_KEYS.length);
      expect(config.redactValuePatterns.length).toBeGreaterThanOrEqual(
        DEFAULT_REDACT_VALUE_PATTERNS.length
      );
    });

    it('does not mutate the shared default pattern arrays', () => {
      const beforeKeys = DEFAULT_REDACT_KEYS.length;
      const beforePatterns = DEFAULT_REDACT_VALUE_PATTERNS.length;

      const service = new LogRedactionService({ extraPatterns: ['customsecret'] });
      service.addPatterns({ keys: ['another'], valuePatterns: [/zzz/g] });

      expect(DEFAULT_REDACT_KEYS).toHaveLength(beforeKeys);
      expect(DEFAULT_REDACT_VALUE_PATTERNS).toHaveLength(beforePatterns);
    });
  });

  describe('metadata key redaction', () => {
    it('redacts string values under sensitive keys', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        password: 'hunter2',
        apiKey: 'sk-live-abc123',
        authorization: 'Bearer tok',
      });
      expect(result.password).toBe(REDACTED_MARKER);
      expect(result.apiKey).toBe(REDACTED_MARKER);
      expect(result.authorization).toBe(REDACTED_MARKER);
    });

    it('matches keys case-insensitively and by substring', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        PASSWORD: 'x',
        userPasswordHash: 'x',
        GITHUB_TOKEN: 'x',
        stripeApiKey: 'x',
      });
      expect(result.PASSWORD).toBe(REDACTED_MARKER);
      expect(result.userPasswordHash).toBe(REDACTED_MARKER);
      expect(result.GITHUB_TOKEN).toBe(REDACTED_MARKER);
      expect(result.stripeApiKey).toBe(REDACTED_MARKER);
    });

    it('redacts non-string values under sensitive keys', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        password: 12345,
        secret: { nested: true },
        token: null,
      });
      expect(result.password).toBe(REDACTED_MARKER);
      expect(result.secret).toBe(REDACTED_MARKER);
      // Even null under a sensitive key is normalized to the marker so log
      // consumers cannot distinguish "absent" from "withheld".
      expect(result.token).toBe(REDACTED_MARKER);
    });

    it('leaves non-sensitive keys untouched', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        userId: 'u-1',
        requestId: 'r-9',
        durationMs: 42,
        tags: ['a', 'b'],
      });
      expect(result).toEqual({
        userId: 'u-1',
        requestId: 'r-9',
        durationMs: 42,
        tags: ['a', 'b'],
      });
    });

    it('does not mutate the input object', () => {
      const service = new LogRedactionService();
      const input = { password: 'hunter2', nested: { apiKey: 'k' } };
      const snapshot = JSON.parse(JSON.stringify(input));

      service.redactMetadata(input);

      expect(input).toEqual(snapshot);
    });
  });

  describe('value pattern redaction in messages', () => {
    it.each([
      ['Bearer abc.def.ghi', 'Bearer '],
      ['Basic dXNlcjpwYXNz', 'Basic '],
      ['token abc123', 'token '],
    ])('redacts auth header schemes: %s', (input) => {
      const service = new LogRedactionService();
      const out = service.redactMessage(input);
      expect(out).not.toContain('abc.def.ghi');
      expect(out).not.toContain('dXNlcjpwYXNz');
      expect(out).not.toContain('abc123');
      expect(out).toContain(REDACTED_MARKER);
    });

    it('redacts GitHub tokens', () => {
      const service = new LogRedactionService();
      // Assembled at runtime so secret scanners never see a token-shaped literal.
      const ghToken = `ghp_${'a1B2'.repeat(9)}`;
      const out = service.redactMessage(`failed with token ${ghToken}`);
      expect(out).not.toContain(ghToken);
      expect(out).toContain(REDACTED_MARKER);
    });

    it('redacts AWS access key ids', () => {
      const service = new LogRedactionService();
      // Assembled at runtime so secret scanners never see a key-shaped literal.
      const awsKey = `AKIA${'IOSFODNN7EXAMPLE'.slice(0, 16)}`;
      const out = service.redactMessage(`using key ${awsKey}`);
      expect(out).not.toContain(awsKey);
    });

    it('redacts Slack tokens', () => {
      const service = new LogRedactionService();
      // Assembled at runtime so secret scanners never see a token-shaped literal.
      const slackToken = `xoxb-${'1'.repeat(12)}-${'abcdefghij'.repeat(2)}x`;
      const out = service.redactMessage(`webhook used ${slackToken}`);
      expect(out).not.toContain(slackToken);
      expect(out).toContain(REDACTED_MARKER);
    });

    it('redacts JWTs', () => {
      const service = new LogRedactionService();
      // Assembled at runtime so secret scanners never see a token-shaped literal.
      const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9Pz'].join('.');
      const out = service.redactMessage(`auth failed for ${jwt}`);
      expect(out).not.toContain(jwt);
    });

    it('redacts hex-encoded private keys with and without 0x prefix', () => {
      const service = new LogRedactionService();
      const hex = 'a'.repeat(64);
      expect(service.redactMessage(`key=0x${hex}`)).not.toContain(hex);
      expect(service.redactMessage(`key=${hex}`)).not.toContain(hex);
    });

    it('redacts Stellar secret keys but not public keys', () => {
      const service = new LogRedactionService();
      // Valid-format Stellar secret key (S + 55 base32 chars)
      const secret = 'S' + 'A'.repeat(55);
      const out = service.redactMessage(`signer ${secret}`);
      expect(out).not.toContain(secret);
      expect(out).toContain(REDACTED_MARKER);

      // Public keys are public identifiers and must survive redaction.
      const pub = 'G' + 'A'.repeat(55);
      expect(service.redactMessage(`account ${pub}`)).toContain(pub);
    });

    it('redacts generic key=value secret assignments', () => {
      const service = new LogRedactionService();
      const out = service.redactMessage('POST /login password=hunter2 retry');
      expect(out).not.toContain('hunter2');
      expect(out).toContain('retry');
    });
  });

  describe('redact() combined entry', () => {
    it('redacts message and metadata together', () => {
      const service = new LogRedactionService();
      const { message, metadata } = service.redact({
        message: 'login failed password=hunter2',
        metadata: { password: 'hunter2', userId: 7 },
      });
      expect(message).not.toContain('hunter2');
      expect(metadata!.password).toBe(REDACTED_MARKER);
      expect(metadata!.userId).toBe(7);
    });

    it('returns undefined metadata when none is supplied', () => {
      const service = new LogRedactionService();
      const { metadata } = service.redact({ message: 'hello' });
      expect(metadata).toBeUndefined();
    });
  });

  // ─── Boundary scenarios ─────────────────────────────────────────

  describe('nested structures', () => {
    it('redacts deeply nested sensitive keys', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        level1: { level2: { level3: { apiKey: 'sk-deep' } } },
      }) as any;
      expect(result.level1.level2.level3.apiKey).toBe(REDACTED_MARKER);
    });

    it('redacts sensitive keys inside arrays of objects', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        users: [
          { name: 'a', password: 'p1' },
          { name: 'b', password: 'p2' },
        ],
      }) as any;
      expect(result.users[0].password).toBe(REDACTED_MARKER);
      expect(result.users[1].password).toBe(REDACTED_MARKER);
      expect(result.users[0].name).toBe('a');
    });

    it('redacts the whole value when the array/object key itself is sensitive', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({
        credentials: [{ user: 'a', note: 'keep me?' }],
      });
      expect(result.credentials).toBe(REDACTED_MARKER);
    });

    it('applies value patterns to strings inside arrays', () => {
      const service = new LogRedactionService();
      const result = service.redactMetadata({ headers: ['Authorization: Bearer abc'] });
      expect(JSON.stringify(result)).not.toContain('Bearer abc');
    });
  });

  describe('cycles and depth', () => {
    it('handles circular references without throwing', () => {
      const service = new LogRedactionService();
      const meta: Record<string, unknown> = { name: 'root' };
      meta.self = meta;

      expect(() => service.redactMetadata(meta)).not.toThrow();
      const result = service.redactMetadata(meta) as any;
      expect(result.name).toBe('root');
      expect(JSON.stringify(result)).toContain('Circular');
    });

    it('caps recursion depth and marks the subtree', () => {
      const service = new LogRedactionService();
      let deep: Record<string, unknown> = { password: 'too-deep' };
      for (let i = 0; i < 30; i++) {
        deep = { nested: deep };
      }
      const result = service.redactMetadata(deep);
      expect(JSON.stringify(result)).not.toContain('too-deep');
      expect(JSON.stringify(result)).toContain('max-depth-exceeded');
    });
  });

  describe('allowlist precedence', () => {
    it('never redacts allowlisted keys, even sensitive-looking ones', () => {
      const service = new LogRedactionService({ allowlist: ['passwordPolicy'] });
      const result = service.redactMetadata({ passwordPolicy: 'min-12-chars' });
      expect(result.passwordPolicy).toBe('min-12-chars');
    });

    it('allowlist beats extraPatterns', () => {
      const service = new LogRedactionService({
        extraPatterns: ['customfield'],
        allowlist: ['customfield'],
      });
      expect(service.isSensitiveKey('customfield')).toBe(false);
    });

    it('isSensitiveKey reflects allowlist handling', () => {
      const service = new LogRedactionService({ allowlist: ['tokenCount'] });
      expect(service.isSensitiveKey('tokenCount')).toBe(false);
      expect(service.isSensitiveKey('token')).toBe(true);
    });
  });

  describe('custom configuration', () => {
    it('extends defaults via extraPatterns', () => {
      const service = new LogRedactionService({ extraPatterns: ['walletmnemonic'] });
      expect(service.redactMetadata({ walletMnemonic: 'x' })).toEqual({
        walletMnemonic: REDACTED_MARKER,
      });
      // Defaults still active
      expect(service.redactMetadata({ apiKey: 'y' })).toEqual({ apiKey: REDACTED_MARKER });
    });

    it('adds custom value regexes via customPatterns', () => {
      const service = new LogRedactionService({ customPatterns: [/\bproj_\w+\b/g] });
      const out = service.redactMessage('created proj_secret123 ok');
      expect(out).not.toContain('proj_secret123');
    });

    it('fully replaces the key list when redactKeys is provided', () => {
      const service = new LogRedactionService({ redactKeys: ['onlythis'] });
      expect(service.isSensitiveKey('onlythis')).toBe(true);
      expect(service.isSensitiveKey('password')).toBe(false);
    });

    it('getConfig returns defensive copies — external mutation must not leak in', () => {
      const service = new LogRedactionService();
      const config = service.getConfig();
      config.redactKeys.push('injected');
      config.redactValuePatterns.push(/evil/g);
      config.allowlist.push('token');

      expect(service.isSensitiveKey('injected')).toBe(false);
      expect(service.redactMessage('evil token')).toBe('evil token');
      expect(service.isSensitiveKey('token')).toBe(true);
    });
  });

  // ─── Failure scenarios ──────────────────────────────────────────

  describe('disabled mode', () => {
    it('passes everything through verbatim when disabled', () => {
      const service = new LogRedactionService({ enabled: false });
      const message = 'password=hunter2';
      expect(service.redactMessage(message)).toBe(message);
      const meta = { password: 'hunter2' };
      expect(service.redactMetadata(meta)).toBe(meta);
    });

    it('toggles at runtime via setEnabled', () => {
      const service = new LogRedactionService();
      expect(service.redactMessage('token abc')).toContain(REDACTED_MARKER);

      service.setEnabled(false);
      expect(service.isEnabled()).toBe(false);
      expect(service.redactMessage('token abc')).toBe('token abc');

      service.setEnabled(true);
      expect(service.redactMessage('token abc')).toContain(REDACTED_MARKER);
    });
  });

  describe('hostile input', () => {
    it('handles objects with null prototype', () => {
      const service = new LogRedactionService();
      const meta = Object.create(null) as Record<string, unknown>;
      meta.password = 'hunter2';
      const result = service.redactMetadata(meta);
      expect(result.password).toBe(REDACTED_MARKER);
    });

    it('drops function and symbol values instead of leaking them', () => {
      const service = new LogRedactionService();
      const fn = () => 'secret return';
      const result = service.redactMetadata({ callback: fn, label: 'keep' });
      expect(result.callback).toBeUndefined();
      expect(result.label).toBe('keep');
    });

    it('converts Error instances to name/message pairs with redaction', () => {
      const service = new LogRedactionService();
      const err = new Error('auth failed with Bearer abc123');
      const result = service.redactMetadata({ error: err }) as any;
      expect(result.error.name).toBe('Error');
      expect(result.error.message).not.toContain('Bearer abc123');
      expect(JSON.stringify(result)).not.toContain('stack');
    });

    it('preserves Date instances', () => {
      const service = new LogRedactionService();
      const when = new Date('2026-01-01T00:00:00Z');
      const result = service.redactMetadata({ when });
      expect(result.when).toBe(when);
    });

    it('handles very long strings without catastrophic behaviour', () => {
      const service = new LogRedactionService();
      const long = 'a'.repeat(100_000) + ' token abc';
      const out = service.redactMessage(long);
      expect(out).not.toContain('token abc');
    });

    it('never emits the original secret even on internal failure (fail closed)', () => {
      const service = new LogRedactionService();

      // Force an internal error by freezing and corrupting internal state.
      (service as unknown as { keyList: unknown }).keyList = null;
      const result = service.redactMetadata({ password: 'hunter2' });

      expect(JSON.stringify(result)).not.toContain('hunter2');
      expect(result.redacted).toBe(true);
    });
  });
});
