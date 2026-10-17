/**
 * Work queue for maintainer signal jobs.
 *
 * Mirrors the SBOM ingestion queue's guarantees:
 * - At most one job per `(tenantId, repositoryId, scanId)` in flight.
 *   Resubmitting the same input returns the existing job; different input
 *   while one is in flight is a CONFLICT.
 * - Workers claim under a `ScanLeaseManager` lease and must present its
 *   fencing token to complete or fail, so a worker that lost its lease cannot
 *   finish a job someone else now owns.
 * - Retryable failures and expired leases go back to `pending` with
 *   exponential backoff until `maxAttempts` claims; everything else
 *   dead-letters. Attempts count at claim time, so a job that crashes its
 *   worker every time still dead-letters.
 * - Global and per-tenant in-flight caps shed load with QUEUE_FULL.
 */

import * as crypto from "crypto";
import { ScanLeaseManager } from "../queue/scan-lease";
import type { MaintainerSignalConfig } from "./maintainer-signal-config";
import type { MaintainerSignalQueueStats } from "./maintainer-signal-metrics";
import {
  MaintainerSignalError,
  MaintainerSignalErrorCode,
  PackageRef,
  isRetryableMaintainerSignalError,
} from "./maintainer-signal-types";

export type MaintainerSignalJobStatus =
  "pending" | "running" | "completed" | "dead_lettered";

/** Where the job's package list comes from. */
export type MaintainerSignalJobInput =
  { source: "packages"; packages: PackageRef[] } | { source: "sbom" };

export interface MaintainerSignalJob {
  jobId: string;
  tenantId: string;
  repositoryId: string;
  scanId: string;
  /** Digest of the input, used for duplicate detection. */
  inputHash: string;
  /** Submission sequence; orders writes to the store. */
  revision: number;
  status: MaintainerSignalJobStatus;
  attempts: number;
  availableAt: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  lastErrorCode?: MaintainerSignalErrorCode;
}

export interface MaintainerSignalJobClaim {
  job: MaintainerSignalJob;
  input: MaintainerSignalJobInput;
  token: number;
}

type QueueLimits = Pick<
  MaintainerSignalConfig,
  | "maxAttempts"
  | "retryBackoffMs"
  | "maxRetryBackoffMs"
  | "leaseTtlMs"
  | "maxPendingJobs"
  | "maxPendingJobsPerTenant"
  | "finishedJobRetentionMs"
>;

interface QueueEntry {
  job: MaintainerSignalJob;
  input?: MaintainerSignalJobInput;
  owner?: string;
}

export class MaintainerSignalJobQueue {
  private readonly leases: ScanLeaseManager;
  private readonly entries = new Map<string, QueueEntry>();
  private readonly latestByScan = new Map<string, string>();
  private readonly activeByTenant = new Map<string, number>();
  private activeTotal = 0;
  private sequence = 0;

  constructor(
    private readonly limits: QueueLimits,
    private readonly clock: () => number = Date.now,
  ) {
    this.leases = new ScanLeaseManager(limits.leaseTtlMs, clock);
  }

  enqueue(submission: {
    tenantId: string;
    repositoryId: string;
    scanId: string;
    input: MaintainerSignalJobInput;
  }): { status: "enqueued" | "duplicate"; job: MaintainerSignalJob } {
    const now = this.clock();
    this.prune(now);
    const inputHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(submission.input), "utf8")
      .digest("hex");
    const key = scanKeyOf(
      submission.tenantId,
      submission.repositoryId,
      submission.scanId,
    );
    const latestId = this.latestByScan.get(key);
    const latest = latestId ? this.entries.get(latestId)?.job : undefined;
    if (latest) {
      const inFlight =
        latest.status === "pending" || latest.status === "running";
      if (
        latest.inputHash === inputHash &&
        (inFlight || latest.status === "completed")
      ) {
        return { status: "duplicate", job: { ...latest } };
      }
      if (inFlight) {
        throw new MaintainerSignalError(
          "CONFLICT",
          "A different maintainer analysis is already running for this scan",
        );
      }
    }
    if (this.activeTotal >= this.limits.maxPendingJobs) {
      throw new MaintainerSignalError(
        "QUEUE_FULL",
        "Maintainer signal queue is full; retry later",
      );
    }
    if (
      (this.activeByTenant.get(submission.tenantId) ?? 0) >=
      this.limits.maxPendingJobsPerTenant
    ) {
      throw new MaintainerSignalError(
        "QUEUE_FULL",
        "Tenant has too many maintainer signal jobs in flight; retry later",
      );
    }
    const job: MaintainerSignalJob = {
      jobId: `msig_${crypto.randomUUID()}`,
      tenantId: submission.tenantId,
      repositoryId: submission.repositoryId,
      scanId: submission.scanId,
      inputHash,
      revision: ++this.sequence,
      status: "pending",
      attempts: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(job.jobId, { job, input: submission.input });
    this.latestByScan.set(key, job.jobId);
    this.activeTotal++;
    this.activeByTenant.set(
      job.tenantId,
      (this.activeByTenant.get(job.tenantId) ?? 0) + 1,
    );
    return { status: "enqueued", job: { ...job } };
  }

  claim(workerId: string): MaintainerSignalJobClaim | undefined {
    if (typeof workerId !== "string" || workerId.trim() === "") {
      throw new TypeError("workerId must be a non-empty string");
    }
    const now = this.clock();
    this.recoverExpired();
    this.prune(now);
    for (const entry of this.entries.values()) {
      const { job } = entry;
      if (job.status !== "pending" || job.availableAt > now) {
        continue;
      }
      const lease = this.leases.acquire(job.jobId, workerId);
      if (!lease.granted) {
        continue;
      }
      job.status = "running";
      job.attempts++;
      job.updatedAt = now;
      entry.owner = workerId;
      return {
        job: { ...job },
        input: entry.input as MaintainerSignalJobInput,
        token: lease.lease.token,
      };
    }
    return undefined;
  }

  isCurrent(jobId: string, workerId: string, token: number): boolean {
    const entry = this.entries.get(jobId);
    const lease = this.leases.get(jobId);
    return (
      entry?.job.status === "running" &&
      entry.owner === workerId &&
      lease?.owner === workerId &&
      lease.token === token
    );
  }

  /** Extend a running job's lease; false if the caller no longer owns it. */
  renew(jobId: string, workerId: string, token: number): boolean {
    return (
      this.isCurrent(jobId, workerId, token) &&
      this.leases.renew(jobId, workerId, token)
    );
  }

  complete(jobId: string, workerId: string, token: number): boolean {
    if (!this.isCurrent(jobId, workerId, token)) {
      return false;
    }
    this.leases.release(jobId, workerId, token);
    this.finish(this.entries.get(jobId) as QueueEntry, "completed");
    return true;
  }

  fail(
    jobId: string,
    workerId: string,
    token: number,
    code: MaintainerSignalErrorCode,
  ): "retry_scheduled" | "dead_lettered" | "stale" {
    if (!this.isCurrent(jobId, workerId, token)) {
      return "stale";
    }
    const entry = this.entries.get(jobId) as QueueEntry;
    this.leases.release(jobId, workerId, token);
    entry.job.lastErrorCode = code;
    if (
      isRetryableMaintainerSignalError(code) &&
      entry.job.attempts < this.limits.maxAttempts
    ) {
      this.reschedule(entry);
      return "retry_scheduled";
    }
    this.finish(entry, "dead_lettered");
    return "dead_lettered";
  }

  recoverExpired(): string[] {
    const recovered: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.job.status !== "running" || this.leases.get(entry.job.jobId)) {
        continue;
      }
      entry.job.lastErrorCode = "LEASE_EXPIRED";
      if (entry.job.attempts < this.limits.maxAttempts) {
        this.reschedule(entry);
      } else {
        this.finish(entry, "dead_lettered");
      }
      recovered.push(entry.job.jobId);
    }
    this.leases.reclaimExpired();
    return recovered;
  }

  get(jobId: string): MaintainerSignalJob | undefined {
    const job = this.entries.get(jobId)?.job;
    return job ? { ...job } : undefined;
  }

  stats(): MaintainerSignalQueueStats {
    const stats = { pending: 0, running: 0, completed: 0, deadLettered: 0 };
    for (const { job } of this.entries.values()) {
      if (job.status === "pending") stats.pending++;
      else if (job.status === "running") stats.running++;
      else if (job.status === "completed") stats.completed++;
      else stats.deadLettered++;
    }
    return stats;
  }

  size(): number {
    return this.entries.size;
  }

  prune(now: number = this.clock()): number {
    let removed = 0;
    for (const [jobId, entry] of this.entries) {
      const { finishedAt } = entry.job;
      if (
        finishedAt === undefined ||
        now < finishedAt + this.limits.finishedJobRetentionMs
      ) {
        continue;
      }
      this.entries.delete(jobId);
      const key = scanKeyOf(
        entry.job.tenantId,
        entry.job.repositoryId,
        entry.job.scanId,
      );
      if (this.latestByScan.get(key) === jobId) {
        this.latestByScan.delete(key);
      }
      removed++;
    }
    return removed;
  }

  private reschedule(entry: QueueEntry): void {
    const now = this.clock();
    const delay = Math.min(
      this.limits.maxRetryBackoffMs,
      this.limits.retryBackoffMs * 2 ** Math.max(0, entry.job.attempts - 1),
    );
    entry.job.status = "pending";
    entry.job.availableAt = now + delay;
    entry.job.updatedAt = now;
    entry.owner = undefined;
  }

  private finish(
    entry: QueueEntry,
    status: "completed" | "dead_lettered",
  ): void {
    const now = this.clock();
    entry.job.status = status;
    entry.job.finishedAt = now;
    entry.job.updatedAt = now;
    entry.owner = undefined;
    entry.input = undefined;
    this.activeTotal = Math.max(0, this.activeTotal - 1);
    const remaining = (this.activeByTenant.get(entry.job.tenantId) ?? 1) - 1;
    if (remaining <= 0) {
      this.activeByTenant.delete(entry.job.tenantId);
    } else {
      this.activeByTenant.set(entry.job.tenantId, remaining);
    }
  }
}

function scanKeyOf(
  tenantId: string,
  repositoryId: string,
  scanId: string,
): string {
  return `${tenantId}\u0000${repositoryId}\u0000${scanId}`;
}
