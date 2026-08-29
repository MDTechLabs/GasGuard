/**
 * Soroban Analysis Profile Marketplace — Importer (Issue #484)
 *
 * Parses and validates a shared profile artifact before it is trusted:
 *  - parses JSON / accepts an already-parsed object,
 *  - checks the envelope discriminator and schema compatibility,
 *  - verifies the integrity checksum (tamper detection),
 *  - validates the profile's structure.
 *
 * Returns a structured result rather than throwing, so callers can surface all
 * problems at once.
 */

import { computeChecksum } from './profile-exporter';
import {
  AnalysisProfile,
  PROFILE_ENVELOPE_KIND,
  PROFILE_SCHEMA_VERSION,
  ProfileImportResult,
  ProfileValidationIssue,
  SharedProfileEnvelope,
} from './types';

/** Major version of the supported schema; only this gates compatibility. */
function majorOf(version: string): number {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? -1 : major;
}

/**
 * A shared artifact is importable if its schema shares the current major
 * version. Same-major minor/patch differences are forwards/backwards tolerant;
 * a different major may have an incompatible shape and is rejected.
 */
export function isSchemaCompatible(schemaVersion: string): boolean {
  const supported = majorOf(PROFILE_SCHEMA_VERSION);
  return supported >= 0 && majorOf(schemaVersion) === supported;
}

/** Validate the shape of a profile payload, collecting all issues. */
export function validateProfile(profile: unknown): ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];
  const push = (path: string, message: string, code: string) =>
    issues.push({ path, message, code });

  if (profile === null || typeof profile !== 'object') {
    push('profile', 'Profile must be an object', 'PROFILE_NOT_OBJECT');
    return issues;
  }
  const p = profile as Record<string, unknown>;

  if (typeof p.id !== 'string' || p.id.trim() === '') {
    push('profile.id', 'Profile id is required and must be a non-empty string', 'ID_REQUIRED');
  }
  if (typeof p.name !== 'string' || p.name.trim() === '') {
    push('profile.name', 'Profile name is required and must be a non-empty string', 'NAME_REQUIRED');
  }
  if (typeof p.description !== 'string') {
    push('profile.description', 'Profile description is required', 'DESCRIPTION_REQUIRED');
  }
  if (p.target !== 'stellar-soroban') {
    push('profile.target', "Profile target must be 'stellar-soroban'", 'TARGET_INVALID');
  }
  if (!Array.isArray(p.rules)) {
    push('profile.rules', 'Profile rules must be an array', 'RULES_INVALID');
  }
  if (p.tags !== undefined && !Array.isArray(p.tags)) {
    push('profile.tags', 'Profile tags, if present, must be an array of strings', 'TAGS_INVALID');
  }

  return issues;
}

/** Parse raw input (JSON string or object) into an unknown value. */
function parseRaw(raw: string | object): { value?: unknown; error?: ProfileValidationIssue } {
  if (typeof raw !== 'string') {
    return { value: raw };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return {
      error: { path: 'envelope', message: 'Input is not valid JSON', code: 'INVALID_JSON' },
    };
  }
}

/**
 * Import a shared profile artifact.
 *
 * @param raw A JSON string or an already-parsed envelope object.
 */
export function importProfile(raw: string | object): ProfileImportResult {
  const errors: ProfileValidationIssue[] = [];
  const warnings: ProfileValidationIssue[] = [];

  const parsed = parseRaw(raw);
  if (parsed.error) {
    return { ok: false, errors: [parsed.error], warnings };
  }

  const env = parsed.value;
  if (env === null || typeof env !== 'object') {
    return {
      ok: false,
      errors: [{ path: 'envelope', message: 'Envelope must be an object', code: 'ENVELOPE_NOT_OBJECT' }],
      warnings,
    };
  }
  const envelope = env as Partial<SharedProfileEnvelope>;

  if (envelope.kind !== PROFILE_ENVELOPE_KIND) {
    errors.push({
      path: 'envelope.kind',
      message: `Unrecognised artifact kind; expected '${PROFILE_ENVELOPE_KIND}'`,
      code: 'KIND_INVALID',
    });
    // Without the discriminator we cannot trust anything else.
    return { ok: false, errors, warnings };
  }

  if (typeof envelope.schemaVersion !== 'string' || !isSchemaCompatible(envelope.schemaVersion)) {
    errors.push({
      path: 'envelope.schemaVersion',
      message: `Incompatible schema version '${String(
        envelope.schemaVersion,
      )}'; this build supports ${PROFILE_SCHEMA_VERSION}`,
      code: 'SCHEMA_INCOMPATIBLE',
    });
    return { ok: false, errors, warnings };
  }

  const structureIssues = validateProfile(envelope.profile);
  errors.push(...structureIssues);
  if (structureIssues.length > 0) {
    return { ok: false, errors, warnings };
  }

  const profile = envelope.profile as AnalysisProfile;

  // Integrity check: recompute the checksum over the profile payload.
  const expected = envelope.metadata?.checksum;
  if (typeof expected !== 'string' || expected.length === 0) {
    warnings.push({
      path: 'envelope.metadata.checksum',
      message: 'No checksum present; integrity could not be verified',
      code: 'CHECKSUM_MISSING',
    });
  } else if (computeChecksum(profile) !== expected) {
    errors.push({
      path: 'envelope.metadata.checksum',
      message: 'Checksum mismatch; the profile may have been modified or corrupted',
      code: 'CHECKSUM_MISMATCH',
    });
    return { ok: false, errors, warnings };
  }

  return { ok: true, profile, errors, warnings };
}
