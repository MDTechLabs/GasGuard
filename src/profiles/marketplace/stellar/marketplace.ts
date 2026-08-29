/**
 * Soroban Analysis Profile Marketplace — Registry (Issue #484)
 *
 * An in-memory marketplace that teams use to share and reuse Soroban analysis
 * profiles: publish/import profiles, list and search them, and export any
 * registered profile back to a portable artifact for sharing elsewhere.
 *
 * Storage is intentionally pluggable-friendly (a simple Map keyed by profile
 * id); a persistent backend can be layered on without changing this API.
 */

import { exportProfile } from './profile-exporter';
import { importProfile } from './profile-importer';
import {
  AnalysisProfile,
  ExportOptions,
  MarketplaceSearchQuery,
  ProfileImportResult,
  SharedProfileEnvelope,
} from './types';

export class StellarProfileMarketplace {
  private readonly profiles = new Map<string, AnalysisProfile>();

  /** Number of profiles currently registered. */
  get size(): number {
    return this.profiles.size;
  }

  /** Whether a profile with the given id is registered. */
  has(id: string): boolean {
    return this.profiles.has(id);
  }

  /** Get a registered profile by id, or `undefined`. */
  get(id: string): AnalysisProfile | undefined {
    return this.profiles.get(id);
  }

  /** List all registered profiles (sorted by name for stable output). */
  list(): AnalysisProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Publish a profile directly into the marketplace.
   *
   * Registration is idempotent on `id`: publishing a profile whose id already
   * exists replaces the previous entry (an upsert), so re-sharing an updated
   * profile does not create duplicates.
   */
  publish(profile: AnalysisProfile): void {
    this.profiles.set(profile.id, profile);
  }

  /** Remove a profile by id. Returns `true` if one was removed. */
  remove(id: string): boolean {
    return this.profiles.delete(id);
  }

  /**
   * Import a shared artifact (JSON string or envelope object) and, when valid,
   * register it. The import result is returned so callers can surface any
   * validation errors/warnings; nothing is registered on failure.
   */
  importFrom(raw: string | object): ProfileImportResult {
    const result = importProfile(raw);
    if (result.ok && result.profile) {
      this.publish(result.profile);
    }
    return result;
  }

  /**
   * Export a registered profile to a shareable envelope.
   *
   * @throws if no profile with `id` is registered.
   */
  export(id: string, options: ExportOptions = {}): SharedProfileEnvelope {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Profile '${id}' is not registered in the marketplace`);
    }
    return exportProfile(profile, options);
  }

  /**
   * Search registered profiles. With no criteria, returns all profiles.
   * Multiple criteria are combined with AND; within `tags`, match is any-of.
   */
  search(query: MarketplaceSearchQuery = {}): AnalysisProfile[] {
    const text = query.text?.toLowerCase().trim();
    const tags = query.tags?.filter((t) => t.length > 0);
    const category = query.category?.toLowerCase().trim();

    return this.list().filter((profile) => {
      if (text) {
        const haystack = `${profile.name} ${profile.description}`.toLowerCase();
        if (!haystack.includes(text)) {
          return false;
        }
      }
      if (tags && tags.length > 0) {
        const profileTags = profile.tags ?? [];
        if (!tags.some((t) => profileTags.includes(t))) {
          return false;
        }
      }
      if (category) {
        const hasCategory = (profile.rules ?? []).some(
          (rule) => typeof rule.category === 'string' && rule.category.toLowerCase() === category,
        );
        if (!hasCategory) {
          return false;
        }
      }
      return true;
    });
  }

  /** Remove all registered profiles. */
  clear(): void {
    this.profiles.clear();
  }
}
