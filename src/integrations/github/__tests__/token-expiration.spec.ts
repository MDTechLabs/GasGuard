import {
  diagnoseTokenExpiration,
  parseTokenExpiration,
  DEFAULT_EXPIRY_WARNING_DAYS,
} from '../token-expiration';

describe('token expiration diagnostics', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;

  describe('parseTokenExpiration', () => {
    it('parses UTC and offset formats', () => {
      expect(parseTokenExpiration('2030-01-10 12:00:00 UTC')?.toISOString()).toBe(
        '2030-01-10T12:00:00.000Z',
      );
      expect(parseTokenExpiration('2030-01-10 12:00:00 -0500')?.toISOString()).toBe(
        '2030-01-10T17:00:00.000Z',
      );
      expect(parseTokenExpiration('2030-01-10 12:00:00 +0530')?.toISOString()).toBe(
        '2030-01-10T06:30:00.000Z',
      );
    });

    it('returns undefined for unsupported formats', () => {
      expect(parseTokenExpiration('tomorrow')).toBeUndefined();
      expect(parseTokenExpiration('2030-01-10')).toBeUndefined();
      expect(parseTokenExpiration('2030-13-45 99:00:00 UTC')).toBeUndefined();
    });
  });

  describe('diagnoseTokenExpiration', () => {
    it('reports no_expiry when the header is absent or blank', () => {
      for (const value of [undefined, null, '', '   ']) {
        expect(diagnoseTokenExpiration(value, now).status).toBe('no_expiry');
      }
    });

    it('reports valid when expiry is beyond the warning window', () => {
      const result = diagnoseTokenExpiration('2030-02-01 00:00:00 UTC', now);
      expect(result.status).toBe('valid');
      expect(result.msRemaining).toBe(31 * DAY);
    });

    it('reports expiring_soon inside the warning window, including the boundary', () => {
      expect(diagnoseTokenExpiration('2030-01-03 00:00:00 UTC', now).status).toBe('expiring_soon');
      expect(
        diagnoseTokenExpiration('2030-01-08 00:00:00 UTC', now, DEFAULT_EXPIRY_WARNING_DAYS).status,
      ).toBe('expiring_soon');
      expect(diagnoseTokenExpiration('2030-01-08 00:00:01 UTC', now).status).toBe('valid');
    });

    it('reports expired at and after the expiry instant', () => {
      expect(diagnoseTokenExpiration('2030-01-01 00:00:00 UTC', now).status).toBe('expired');
      const past = diagnoseTokenExpiration('2029-12-31 00:00:00 UTC', now);
      expect(past.status).toBe('expired');
      expect(past.msRemaining).toBe(-DAY);
    });

    it('honours a custom warning window', () => {
      expect(diagnoseTokenExpiration('2030-01-20 00:00:00 UTC', now, 30).status).toBe('expiring_soon');
      expect(diagnoseTokenExpiration('2030-01-02 00:00:00 UTC', now, 0).status).toBe('valid');
    });

    it('reports invalid for an unparseable header without echoing it', () => {
      const result = diagnoseTokenExpiration('ghp_secret-looking-value', now);
      expect(result.status).toBe('invalid');
      expect(result.message).not.toContain('ghp_');
    });

    it('rejects an invalid warning window', () => {
      expect(() => diagnoseTokenExpiration('2030-02-01 00:00:00 UTC', now, -1)).toThrow(/warnDays/);
      expect(() => diagnoseTokenExpiration('2030-02-01 00:00:00 UTC', now, NaN)).toThrow(/warnDays/);
    });
  });
});
