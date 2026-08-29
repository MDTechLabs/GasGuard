/**
 * Soroban Analysis Profile Marketplace — Types (Issue #484)
 *
 * A Soroban *analysis profile* is a named, reusable scan configuration (a set
 * of rule selections/overrides plus optional system overrides). Teams keep
 * recreating similar configurations; the marketplace lets them **export** a
 * profile to a portable, self-describing artifact and **import** profiles
 * shared by others, with integrity and schema-compatibility checks.
 *
 * This builds on the existing `ConfigurationProfile` model in
 * `src/config/config.types.ts` so profiles stay compatible with the config
 * system rather than introducing a parallel shape.
 */

import { ConfigurationProfile } from '../../../config/config.types';

/**
 * Schema version of the shareable envelope format.
 *
 * Follows semver; only the **major** component gates import compatibility
 * (see `isSchemaCompatible`). Bump the major when the envelope/profile shape
 * changes in a backwards-incompatible way.
 */
export const PROFILE_SCHEMA_VERSION = '1.0.0';

/** Discriminator embedded in every exported artifact for safe parsing. */
export const PROFILE_ENVELOPE_KIND = 'gasguard.analysis-profile' as const;

/** Analysis target a profile applies to. Scoped to Stellar/Soroban here. */
export type AnalysisTarget = 'stellar-soroban';

/** Optional authorship metadata attached at export time. */
export interface ProfileAuthor {
  name: string;
  contact?: string;
  organization?: string;
}

/**
 * A shareable Soroban analysis profile.
 *
 * Extends `ConfigurationProfile` (name, description, rules, systemOverrides)
 * with a stable `id` for dedup/lookup, the analysis `target`, and free-form
 * `tags` for marketplace discovery.
 */
export interface AnalysisProfile extends ConfigurationProfile {
  /** Stable identifier (slug) used for dedup and lookup. */
  id: string;
  /** Analysis target this profile applies to. */
  target: AnalysisTarget;
  /** Free-form tags for discovery/search in the marketplace. */
  tags?: string[];
}

/** Provenance + integrity metadata carried alongside an exported profile. */
export interface ProfileEnvelopeMetadata {
  /** ISO-8601 timestamp the artifact was exported. */
  exportedAt: string;
  /** GasGuard version that produced the artifact. */
  gasguardVersion: string;
  /** SHA-256 of the canonicalised profile payload, for tamper detection. */
  checksum: string;
  /** Who produced/shared the profile (optional). */
  author?: ProfileAuthor;
}

/**
 * Portable, self-describing artifact produced by export and consumed by
 * import. This is the unit shared between teams (typically as JSON).
 */
export interface SharedProfileEnvelope {
  kind: typeof PROFILE_ENVELOPE_KIND;
  schemaVersion: string;
  metadata: ProfileEnvelopeMetadata;
  profile: AnalysisProfile;
}

/** A single validation problem found while importing a profile. */
export interface ProfileValidationIssue {
  path: string;
  message: string;
  code: string;
}

/** Outcome of an import attempt. `profile` is present only when `ok` is true. */
export interface ProfileImportResult {
  ok: boolean;
  profile?: AnalysisProfile;
  errors: ProfileValidationIssue[];
  warnings: ProfileValidationIssue[];
}

/** Options for exporting a profile. */
export interface ExportOptions {
  author?: ProfileAuthor;
  /** Override the recorded GasGuard version (defaults to the module version). */
  gasguardVersion?: string;
}

/** Query for locating profiles in the marketplace. All fields are optional. */
export interface MarketplaceSearchQuery {
  /** Case-insensitive substring match against name and description. */
  text?: string;
  /** Match profiles carrying any of these tags. */
  tags?: string[];
  /** Match profiles that include at least one rule in this category. */
  category?: string;
}
