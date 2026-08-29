/**
 * Soroban Analysis Profile Marketplace — Exporter (Issue #484)
 *
 * Wraps an `AnalysisProfile` in a portable, self-describing envelope with
 * provenance and an integrity checksum, and serialises it to JSON for sharing.
 */

import { createHash } from 'crypto';
import {
  AnalysisProfile,
  ExportOptions,
  PROFILE_ENVELOPE_KIND,
  PROFILE_SCHEMA_VERSION,
  ProfileEnvelopeMetadata,
  SharedProfileEnvelope,
} from './types';

/** Module version recorded in exported artifacts. */
export const MARKETPLACE_VERSION = '1.0.0';

/**
 * Deterministically stringify a value with object keys sorted recursively.
 *
 * The checksum must be stable regardless of property insertion order, so two
 * semantically identical profiles always hash to the same value.
 */
export function canonicalize(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') {
      return v;
    }
    if (seen.has(v as object)) {
      throw new Error('Cannot canonicalize a value with circular references');
    }
    seen.add(v as object);

    if (Array.isArray(v)) {
      return v.map(normalize);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      const inner = (v as Record<string, unknown>)[key];
      if (inner !== undefined) {
        out[key] = normalize(inner);
      }
    }
    return out;
  };

  return JSON.stringify(normalize(value));
}

/** Compute the SHA-256 checksum of a profile's canonical representation. */
export function computeChecksum(profile: AnalysisProfile): string {
  return createHash('sha256').update(canonicalize(profile)).digest('hex');
}

/**
 * Export a profile into a shareable envelope.
 *
 * The returned envelope embeds a schema version, provenance metadata, and a
 * checksum over the profile so importers can detect tampering or corruption.
 */
export function exportProfile(
  profile: AnalysisProfile,
  options: ExportOptions = {},
): SharedProfileEnvelope {
  const metadata: ProfileEnvelopeMetadata = {
    exportedAt: new Date().toISOString(),
    gasguardVersion: options.gasguardVersion ?? MARKETPLACE_VERSION,
    checksum: computeChecksum(profile),
    ...(options.author ? { author: options.author } : {}),
  };

  return {
    kind: PROFILE_ENVELOPE_KIND,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    metadata,
    profile,
  };
}

/** Serialise an envelope to a JSON string suitable for sharing/storage. */
export function serializeEnvelope(
  envelope: SharedProfileEnvelope,
  pretty = true,
): string {
  return pretty
    ? JSON.stringify(envelope, null, 2)
    : JSON.stringify(envelope);
}

/** Convenience: export a profile straight to a JSON string. */
export function exportProfileToJson(
  profile: AnalysisProfile,
  options: ExportOptions = {},
  pretty = true,
): string {
  return serializeEnvelope(exportProfile(profile, options), pretty);
}
