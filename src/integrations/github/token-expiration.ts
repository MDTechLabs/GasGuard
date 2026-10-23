/**
 * Integration Token Expiration Diagnostics
 *
 * Interprets the `github-authentication-token-expiration` response header
 * (e.g. `2030-01-01 12:00:00 UTC` or `2030-01-01 12:00:00 -0500`).
 */

export const TOKEN_EXPIRATION_HEADER = 'github-authentication-token-expiration';
export const DEFAULT_EXPIRY_WARNING_DAYS = 7;

export type TokenExpirationStatus = 'no_expiry' | 'valid' | 'expiring_soon' | 'expired' | 'invalid';

export interface TokenExpirationDiagnostic {
  status: TokenExpirationStatus;
  expiresAt?: Date;
  msRemaining?: number;
  message: string;
}

const HEADER_FORMAT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (UTC|[+-]\d{4})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseTokenExpiration(value: string): Date | undefined {
  const match = HEADER_FORMAT.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, y, mo, d, h, mi, s, zone] = match;
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function diagnoseTokenExpiration(
  headerValue: string | undefined | null,
  now: Date = new Date(),
  warnDays: number = DEFAULT_EXPIRY_WARNING_DAYS,
): TokenExpirationDiagnostic {
  if (!Number.isFinite(warnDays) || warnDays < 0) {
    throw new Error('warnDays must be a non-negative number');
  }
  if (headerValue === undefined || headerValue === null || headerValue.trim() === '') {
    return { status: 'no_expiry', message: 'Token does not report an expiration date.' };
  }

  const expiresAt = parseTokenExpiration(headerValue);
  if (!expiresAt) {
    return { status: 'invalid', message: 'Token expiration header could not be parsed.' };
  }

  const msRemaining = expiresAt.getTime() - now.getTime();
  if (msRemaining <= 0) {
    return {
      status: 'expired',
      expiresAt,
      msRemaining,
      message: `Token expired at ${expiresAt.toISOString()}.`,
    };
  }
  if (msRemaining <= warnDays * DAY_MS) {
    return {
      status: 'expiring_soon',
      expiresAt,
      msRemaining,
      message: `Token expires at ${expiresAt.toISOString()} (within ${warnDays} days).`,
    };
  }
  return {
    status: 'valid',
    expiresAt,
    msRemaining,
    message: `Token is valid until ${expiresAt.toISOString()}.`,
  };
}
