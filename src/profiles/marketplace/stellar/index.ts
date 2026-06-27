/**
 * Soroban Analysis Profile Marketplace (Issue #484)
 *
 * Public entry point for sharing and importing Soroban analysis profiles.
 *
 * @example
 * ```ts
 * import {
 *   StellarProfileMarketplace,
 *   exportProfileToJson,
 *   type AnalysisProfile,
 * } from 'src/profiles/marketplace/stellar';
 *
 * const market = new StellarProfileMarketplace();
 * market.publish(myProfile);
 *
 * // Share it
 * const json = exportProfileToJson(myProfile, { author: { name: 'team-sec' } });
 *
 * // Someone else imports it
 * const other = new StellarProfileMarketplace();
 * const result = other.importFrom(json);
 * if (result.ok) console.log('imported', result.profile?.name);
 * ```
 */

export * from './types';
export {
  MARKETPLACE_VERSION,
  canonicalize,
  computeChecksum,
  exportProfile,
  exportProfileToJson,
  serializeEnvelope,
} from './profile-exporter';
export { importProfile, isSchemaCompatible, validateProfile } from './profile-importer';
export { StellarProfileMarketplace } from './marketplace';
