/**
 * Persistence boundary for maintainer baselines and per-scan reports.
 *
 * Baselines are keyed by `(tenantId, repositoryId, ecosystem, package)` and
 * reports by `(tenantId, repositoryId, scanId)`. Every call takes the tenant id
 * explicitly and implementations never resolve a key across tenants, so two
 * tenants scanning the same public package keep independent baselines: one
 * tenant's scan can never suppress or trigger another tenant's signals.
 *
 * Writes are conditional on `revision` (the job queue's submission sequence):
 * a record is only replaced by one with an equal or higher revision, so a
 * stalled worker that finishes late cannot roll a baseline back. Equal
 * revisions are accepted because a retried job rewrites identical content.
 */

import * as crypto from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import type { MaintainerBaseline } from "./maintainer-signal-analyzer";
import {
  MaintainerSignalError,
  MaintainerSignalReport,
} from "./maintainer-signal-types";

export interface MaintainerBaselineKey {
  ecosystem: string;
  package: string;
}

export interface MaintainerSignalStore {
  /** Baselines that exist for `keys`; missing keys are simply absent. */
  getBaselines(
    tenantId: string,
    repositoryId: string,
    keys: MaintainerBaselineKey[],
  ): Promise<MaintainerBaseline[]>;
  /**
   * Upsert baselines, skipping any whose stored revision is higher. Returns the
   * number of baselines actually written.
   */
  putBaselines(
    tenantId: string,
    repositoryId: string,
    baselines: MaintainerBaseline[],
  ): Promise<number>;
  /** Upsert unless a report with a higher revision exists. */
  putReport(report: MaintainerSignalReport): Promise<"written" | "stale">;
  getReport(
    tenantId: string,
    repositoryId: string,
    scanId: string,
  ): Promise<MaintainerSignalReport | undefined>;
}

export class InMemoryMaintainerSignalStore implements MaintainerSignalStore {
  // Values are serialized so callers can never mutate stored state by reference.
  private readonly baselines: Map<string, string> = new Map();
  private readonly reports: Map<string, string> = new Map();

  async getBaselines(
    tenantId: string,
    repositoryId: string,
    keys: MaintainerBaselineKey[],
  ): Promise<MaintainerBaseline[]> {
    const found: MaintainerBaseline[] = [];
    for (const key of keys) {
      const raw = this.baselines.get(
        baselineKey(tenantId, repositoryId, key.ecosystem, key.package),
      );
      if (raw !== undefined) {
        found.push(JSON.parse(raw) as MaintainerBaseline);
      }
    }
    return found;
  }

  async putBaselines(
    tenantId: string,
    repositoryId: string,
    baselines: MaintainerBaseline[],
  ): Promise<number> {
    let written = 0;
    for (const baseline of baselines) {
      const key = baselineKey(
        tenantId,
        repositoryId,
        baseline.ecosystem,
        baseline.package,
      );
      const existing = this.baselines.get(key);
      if (
        existing &&
        (JSON.parse(existing) as MaintainerBaseline).revision >
          baseline.revision
      ) {
        continue;
      }
      this.baselines.set(key, JSON.stringify(baseline));
      written++;
    }
    return written;
  }

  async putReport(
    report: MaintainerSignalReport,
  ): Promise<"written" | "stale"> {
    const key = scanKey(report.tenantId, report.repositoryId, report.scanId);
    const existing = this.reports.get(key);
    if (
      existing &&
      (JSON.parse(existing) as MaintainerSignalReport).revision >
        report.revision
    ) {
      return "stale";
    }
    this.reports.set(key, JSON.stringify(report));
    return "written";
  }

  async getReport(
    tenantId: string,
    repositoryId: string,
    scanId: string,
  ): Promise<MaintainerSignalReport | undefined> {
    const raw = this.reports.get(scanKey(tenantId, repositoryId, scanId));
    return raw === undefined
      ? undefined
      : (JSON.parse(raw) as MaintainerSignalReport);
  }

  baselineCount(): number {
    return this.baselines.size;
  }
}

interface BaselineFile {
  tenantId: string;
  repositoryId: string;
  /** Keyed by `ecosystem\u0000package`. */
  baselines: Record<string, MaintainerBaseline>;
}

/**
 * Durable store: one JSON file of baselines per repository and one per scan
 * report, under a per-tenant directory. Paths are SHA-256 digests of the ids,
 * so crafted ids cannot escape `rootDir`. Writes go to a temporary file and are
 * renamed into place, so a crash leaves the old or the new file, never a torn
 * one. Conditional writes are serialized per file within this process; a
 * multi-process deployment should use a database-backed store that performs
 * the revision check atomically.
 */
export class FileMaintainerSignalStore implements MaintainerSignalStore {
  private readonly rootDir: string;
  private readonly locks: Map<string, Promise<unknown>> = new Map();

  constructor(rootDir: string) {
    if (typeof rootDir !== "string" || rootDir.trim() === "") {
      throw new TypeError("rootDir must be a non-empty string");
    }
    this.rootDir = path.resolve(rootDir);
  }

  async getBaselines(
    tenantId: string,
    repositoryId: string,
    keys: MaintainerBaselineKey[],
  ): Promise<MaintainerBaseline[]> {
    const file = await this.readBaselineFile(tenantId, repositoryId);
    if (!file) {
      return [];
    }
    return keys
      .map((k) => file.baselines[packageKeyOf(k.ecosystem, k.package)])
      .filter((b): b is MaintainerBaseline => b !== undefined);
  }

  putBaselines(
    tenantId: string,
    repositoryId: string,
    baselines: MaintainerBaseline[],
  ): Promise<number> {
    const target = this.baselinePath(tenantId, repositoryId);
    return this.withLock(target, async () => {
      const file = (await this.readBaselineFile(tenantId, repositoryId)) ?? {
        tenantId,
        repositoryId,
        baselines: {},
      };
      let written = 0;
      for (const baseline of baselines) {
        const key = packageKeyOf(baseline.ecosystem, baseline.package);
        const existing = file.baselines[key];
        if (existing && existing.revision > baseline.revision) {
          continue;
        }
        file.baselines[key] = baseline;
        written++;
      }
      if (written > 0) {
        await this.writeAtomic(target, file);
      }
      return written;
    });
  }

  putReport(report: MaintainerSignalReport): Promise<"written" | "stale"> {
    const target = this.reportPath(
      report.tenantId,
      report.repositoryId,
      report.scanId,
    );
    return this.withLock(target, async () => {
      const existing = await this.getReport(
        report.tenantId,
        report.repositoryId,
        report.scanId,
      );
      if (existing && existing.revision > report.revision) {
        return "stale";
      }
      await this.writeAtomic(target, report);
      return "written";
    });
  }

  async getReport(
    tenantId: string,
    repositoryId: string,
    scanId: string,
  ): Promise<MaintainerSignalReport | undefined> {
    const report = await this.readJson<MaintainerSignalReport>(
      this.reportPath(tenantId, repositoryId, scanId),
    );
    if (
      report &&
      (report.tenantId !== tenantId ||
        report.repositoryId !== repositoryId ||
        report.scanId !== scanId)
    ) {
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Stored maintainer report does not match its key",
      );
    }
    return report;
  }

  private async readBaselineFile(
    tenantId: string,
    repositoryId: string,
  ): Promise<BaselineFile | undefined> {
    const file = await this.readJson<BaselineFile>(
      this.baselinePath(tenantId, repositoryId),
    );
    // Defence in depth: the digest path must hold the record it was asked for.
    if (
      file &&
      (file.tenantId !== tenantId || file.repositoryId !== repositoryId)
    ) {
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Stored maintainer baselines do not match their key",
      );
    }
    return file;
  }

  private async readJson<T>(file: string): Promise<T | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return undefined;
      }
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Failed to read maintainer signal record",
      );
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Stored maintainer signal record is corrupt",
      );
    }
  }

  private async writeAtomic(file: string, value: unknown): Promise<void> {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(value), {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.rename(tmp, file);
    } catch {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw new MaintainerSignalError(
        "STORAGE_FAILURE",
        "Failed to persist maintainer signal record",
      );
    }
  }

  private baselinePath(tenantId: string, repositoryId: string): string {
    return path.join(
      this.rootDir,
      digest(tenantId),
      "baselines",
      `${digest(repositoryId)}.json`,
    );
  }

  private reportPath(
    tenantId: string,
    repositoryId: string,
    scanId: string,
  ): string {
    return path.join(
      this.rootDir,
      digest(tenantId),
      "reports",
      `${digest(`${repositoryId}\u0000${scanId}`)}.json`,
    );
  }

  private withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch(() => undefined);
    this.locks.set(key, settled);
    void settled.then(() => {
      if (this.locks.get(key) === settled) {
        this.locks.delete(key);
      }
    });
    return run;
  }
}

function packageKeyOf(ecosystem: string, pkg: string): string {
  return `${ecosystem}\u0000${pkg}`;
}

function baselineKey(
  tenantId: string,
  repositoryId: string,
  ecosystem: string,
  pkg: string,
): string {
  return `${tenantId}\u0000${repositoryId}\u0000${ecosystem}\u0000${pkg}`;
}

function scanKey(
  tenantId: string,
  repositoryId: string,
  scanId: string,
): string {
  return `${tenantId}\u0000${repositoryId}\u0000${scanId}`;
}

function digest(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
