/**
 * Orphaned job cleanup (#1092).
 *
 * A worker that dies mid-scan leaves its job marked as running forever, which
 * blocks retries and inflates queue depth. A job is orphaned when the worker
 * that owns it has stopped heartbeating for longer than the grace period; the
 * cleanup planner then reports which job ids may be released back to the queue.
 *
 * The planner is read-only: it returns a plan and never mutates the records it
 * is given, so the caller decides whether to requeue or fail each job.
 */

import type { WorkerHeartbeatRegistry } from "./worker-heartbeat-registry";

export interface JobRecord {
  jobId: string;
  workerId: string;
  startedAt: number;
  /** Last time the job itself reported progress. */
  heartbeatAt: number;
}

export type OrphanReason = "worker_stale" | "job_stale";

export interface OrphanedJob {
  jobId: string;
  workerId: string;
  reason: OrphanReason;
  idleMs: number;
}

export interface CleanupPlan {
  orphaned: OrphanedJob[];
  active: string[];
  /** Jobs skipped because their worker is still alive, oldest first. */
  skippedCount: number;
}

export interface CleanupOptions {
  /** How long a job may go without progress before it is orphaned. */
  jobGraceMs: number;
  /** Maximum jobs released in one pass. */
  maxPerPass: number;
}

export const DEFAULT_CLEANUP_OPTIONS: CleanupOptions = {
  jobGraceMs: 5 * 60_000,
  maxPerPass: 100,
};

export class OrphanedJobCleanup {
  private readonly options: CleanupOptions;
  private readonly clock: () => number;

  constructor(options: Partial<CleanupOptions> = {}, clock: () => number = Date.now) {
    this.options = { ...DEFAULT_CLEANUP_OPTIONS, ...options };
    if (!Number.isInteger(this.options.jobGraceMs) || this.options.jobGraceMs <= 0) {
      throw new RangeError("jobGraceMs must be a positive integer");
    }
    if (!Number.isInteger(this.options.maxPerPass) || this.options.maxPerPass <= 0) {
      throw new RangeError("maxPerPass must be a positive integer");
    }
    this.clock = clock;
  }

  /**
   * Plan the cleanup for a batch of running jobs.
   *
   * A job with a dead worker is orphaned as `worker_stale`; a job whose worker
   * is alive but which has not reported progress beyond the grace period is
   * orphaned as `job_stale`. Both kinds are ordered oldest-idle first so
   * repeated passes make progress in a stable order.
   */
  plan(
    jobs: readonly JobRecord[],
    heartbeats: Pick<WorkerHeartbeatRegistry, "isAlive">,
    now: number = this.clock(),
  ): CleanupPlan {
    const staleWorkerIds = new Set(
      [...new Set(jobs.map((job) => job.workerId))].filter(
        (workerId) => !heartbeats.isAlive(workerId),
      ),
    );

    const orphaned: OrphanedJob[] = [];
    const active: string[] = [];

    for (const job of jobs) {
      if (!Number.isInteger(job.startedAt) || job.startedAt < 0) {
        throw new RangeError(`job ${job.jobId} has an invalid startedAt`);
      }

      const idleMs = Math.max(0, now - job.heartbeatAt);

      if (staleWorkerIds.has(job.workerId)) {
        orphaned.push({ jobId: job.jobId, workerId: job.workerId, reason: "worker_stale", idleMs });
        continue;
      }

      if (idleMs >= this.options.jobGraceMs) {
        orphaned.push({ jobId: job.jobId, workerId: job.workerId, reason: "job_stale", idleMs });
        continue;
      }

      active.push(job.jobId);
    }

    orphaned.sort(
      (left, right) =>
        right.idleMs - left.idleMs || (left.jobId < right.jobId ? -1 : 1),
    );

    const selected = orphaned.slice(0, this.options.maxPerPass);

    return {
      orphaned: selected,
      active,
      skippedCount: orphaned.length - selected.length,
    };
  }
}
