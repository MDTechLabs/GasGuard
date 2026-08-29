/**
 * Soroban Analysis Report Version Manager
 *
 * Manages versioned snapshots of generated analysis reports.
 * Supports creating new versions, retrieving historical revisions,
 * diffing between versions, and listing the full version history.
 */

import {
  ReportVersion,
  VersionDiff,
  VersionDump,
  ModifiedEntry,
} from "./types";

/**
 * Manager for versioned Soroban analysis reports.
 */
export class ReportVersionManager {
  private versions: Map<string, ReportVersion> = new Map();
  private versionCounter: number = 0;

  constructor() {}

  /**
   * Create a new version from the given report data.
   * Returns the newly created ReportVersion.
   */
  createVersion(
    data: Record<string, unknown>,
    metadata?: ReportVersion["metadata"],
  ): ReportVersion {
    this.versionCounter++;
    const id = `v${this.versionCounter}`;
    const version = `1.${this.versionCounter}.0`;

    const reportVersion: ReportVersion = {
      id,
      version,
      createdAt: new Date(),
      data: this.deepClone(data),
      metadata,
    };

    this.versions.set(id, reportVersion);
    return reportVersion;
  }

  /**
   * Retrieve a specific version by its ID.
   * Returns undefined if the version does not exist.
   */
  getVersion(id: string): ReportVersion | undefined {
    const version = this.versions.get(id);
    if (!version) return undefined;
    return this.deepClone(version);
  }

  /**
   * Compute a diff between two versions.
   * Returns a VersionDiff describing added, removed, and modified keys.
   */
  diffVersions(fromId: string, toId: string): VersionDiff {
    const fromVersion = this.versions.get(fromId);
    const toVersion = this.versions.get(toId);

    if (!fromVersion) {
      throw new Error(`Source version "${fromId}" not found`);
    }
    if (!toVersion) {
      throw new Error(`Target version "${toId}" not found`);
    }

    const fromData = fromVersion.data;
    const toData = toVersion.data;

    const allKeys = new Set([
      ...Object.keys(fromData),
      ...Object.keys(toData),
    ]);

    const added: string[] = [];
    const removed: string[] = [];
    const modified: ModifiedEntry[] = [];

    for (const key of allKeys) {
      const inFrom = key in fromData;
      const inTo = key in toData;

      if (!inFrom && inTo) {
        added.push(key);
      } else if (inFrom && !inTo) {
        removed.push(key);
      } else if (
        inFrom &&
        inTo &&
        !this.deepEqual(fromData[key], toData[key])
      ) {
        modified.push({
          key,
          oldValue: fromData[key],
          newValue: toData[key],
        });
      }
    }

    const summary = this.buildDiffSummary(fromId, toId, added, removed, modified);

    return {
      fromVersion: fromId,
      toVersion: toId,
      added,
      removed,
      modified,
      summary,
      generatedAt: new Date(),
    };
  }

  /**
   * List all stored versions in creation order.
   */
  listVersions(): ReportVersion[] {
    const entries = Array.from(this.versions.entries());
    entries.sort((a, b) => {
      const aNum = parseInt(a[0].slice(1), 10);
      const bNum = parseInt(b[0].slice(1), 10);
      return aNum - bNum;
    });
    return entries.map(([, v]) => this.deepClone(v));
  }

  /**
   * Export all versions as a VersionDump for serialization.
   */
  exportDump(metadata?: Record<string, unknown>): VersionDump {
    const versions = this.listVersions();
    return {
      formatVersion: "1.0",
      exportedAt: new Date(),
      versions,
      totalVersions: versions.length,
      metadata,
    };
  }

  /**
   * Import versions from a VersionDump into this manager.
   */
  importDump(dump: VersionDump): void {
    for (const version of dump.versions) {
      this.versions.set(version.id, version);
      const numId = parseInt(version.id.slice(1), 10);
      if (numId > this.versionCounter) {
        this.versionCounter = numId;
      }
    }
  }

  /**
   * Get the total number of stored versions.
   */
  get versionCount(): number {
    return this.versions.size;
  }

  /**
   * Remove all versions from the manager.
   */
  clear(): void {
    this.versions.clear();
    this.versionCounter = 0;
  }

  private buildDiffSummary(
    fromId: string,
    toId: string,
    added: string[],
    removed: string[],
    modified: ModifiedEntry[],
  ): string {
    const parts: string[] = [];
    parts.push(`Diff between ${fromId} and ${toId}:`);

    if (added.length > 0) {
      parts.push(`${added.length} key(s) added`);
    }
    if (removed.length > 0) {
      parts.push(`${removed.length} key(s) removed`);
    }
    if (modified.length > 0) {
      parts.push(`${modified.length} key(s) modified`);
    }

    if (added.length === 0 && removed.length === 0 && modified.length === 0) {
      parts.push("no changes detected");
    }

    return parts.join(", ");
  }

  private deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
