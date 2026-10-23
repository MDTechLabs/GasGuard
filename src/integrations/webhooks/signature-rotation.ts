/**
 * Webhook Signature Rotation
 *
 * Signs with the current secret and keeps the previous secret valid for a
 * grace window so receivers can roll over without dropping deliveries.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const WEBHOOK_SIGNATURE_ALGO = 'sha256';
export const MIN_WEBHOOK_SECRET_LENGTH = 16;
export const DEFAULT_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export interface SignatureRotationOptions {
  graceMs?: number;
  now?: () => number;
}

export type SignatureMatch = 'current' | 'previous';

export interface SignatureVerification {
  valid: boolean;
  matched?: SignatureMatch;
  reason?: 'malformed' | 'mismatch';
}

export class WebhookSignatureRotation {
  private current: string;
  private previous?: string;
  private previousExpiresAt = 0;
  private readonly graceMs: number;
  private readonly now: () => number;

  constructor(secret: string, options: SignatureRotationOptions = {}) {
    this.graceMs = options.graceMs ?? DEFAULT_ROTATION_GRACE_MS;
    if (!Number.isFinite(this.graceMs) || this.graceMs < 0) {
      throw new Error('graceMs must be a non-negative number');
    }
    this.now = options.now ?? Date.now;
    this.current = WebhookSignatureRotation.assertSecret(secret);
  }

  /**
   * Promote a new secret (generated when omitted). The old secret stays
   * valid for verification until the grace window ends.
   */
  rotate(newSecret?: string): { secret: string; previousExpiresAt: number } {
    const secret = WebhookSignatureRotation.assertSecret(
      newSecret ?? randomBytes(32).toString('hex'),
    );
    if (secret === this.current) {
      throw new Error('New webhook secret must differ from the current secret');
    }
    this.previous = this.current;
    this.previousExpiresAt = this.now() + this.graceMs;
    this.current = secret;
    return { secret, previousExpiresAt: this.previousExpiresAt };
  }

  /** Header value for the current secret: `sha256=<hex>`. */
  sign(body: string): string {
    return `${WEBHOOK_SIGNATURE_ALGO}=${this.digest(body, this.current)}`;
  }

  verify(body: string, signature: string): SignatureVerification {
    if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
      return { valid: false, reason: 'malformed' };
    }
    const incoming = Buffer.from(signature.slice('sha256='.length), 'hex');

    if (this.matches(body, this.current, incoming)) {
      return { valid: true, matched: 'current' };
    }
    if (this.previousActive() && this.matches(body, this.previous as string, incoming)) {
      return { valid: true, matched: 'previous' };
    }
    return { valid: false, reason: 'mismatch' };
  }

  getStatus(): { hasPrevious: boolean; previousExpiresAt?: number } {
    const hasPrevious = this.previousActive();
    return hasPrevious
      ? { hasPrevious, previousExpiresAt: this.previousExpiresAt }
      : { hasPrevious };
  }

  private previousActive(): boolean {
    return this.previous !== undefined && this.now() < this.previousExpiresAt;
  }

  private matches(body: string, secret: string, incoming: Buffer): boolean {
    const expected = Buffer.from(this.digest(body, secret), 'hex');
    return expected.length === incoming.length && timingSafeEqual(expected, incoming);
  }

  private digest(body: string, secret: string): string {
    return createHmac(WEBHOOK_SIGNATURE_ALGO, secret).update(body).digest('hex');
  }

  private static assertSecret(secret: string): string {
    if (typeof secret !== 'string' || secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
      throw new Error(
        `Webhook secret must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`,
      );
    }
    return secret;
  }
}
