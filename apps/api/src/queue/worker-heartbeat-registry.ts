/**
 * Worker heartbeat monitoring (#1090).
 *
 * Every worker periodically records a heartbeat. The registry keeps the latest
 * heartbeat per worker and classifies workers as live or stale against a TTL,
 * which is what lets the queue tell "busy" apart from "gone" and reclaim work
 * from workers that stopped reporting.
 *
 * Time is injected, so staleness is deterministic in tests and the registry
 * never depends on a timer of its own.
 */

export interface WorkerHeartbeat {
  workerId: string;
  heartbeatAt: number;
  /** Configured concurrency the worker advertised. */
  concurrency?: number;
  /** Jobs the worker reports as in flight. */
  activeJobs?: number;
}

export interface WorkerHeartbeatSnapshot {
  ttlMs: number;
  liveWorkers: number;
  staleWorkers: number;
  /** Total jobs reported in flight across live workers. */
  activeJobs: number;
}

export const DEFAULT_HEARTBEAT_TTL_MS = 30_000;

export class WorkerHeartbeatRegistry {
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly heartbeats = new Map<string, WorkerHeartbeat>();

  constructor(ttlMs: number = DEFAULT_HEARTBEAT_TTL_MS, clock: () => number = Date.now) {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new RangeError("ttlMs must be a positive integer");
    }
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  /** Record a heartbeat for `workerId`, replacing any previous one. */
  beat(
    workerId: string,
    info: { concurrency?: number; activeJobs?: number } = {},
    now: number = this.clock(),
  ): WorkerHeartbeat {
    requireNonEmpty(workerId, "workerId");

    if (info.concurrency !== undefined && (!Number.isInteger(info.concurrency) || info.concurrency <= 0)) {
      throw new RangeError("concurrency must be a positive integer");
    }
    if (info.activeJobs !== undefined && (!Number.isInteger(info.activeJobs) || info.activeJobs < 0)) {
      throw new RangeError("activeJobs must be a non-negative integer");
    }

    const heartbeat: WorkerHeartbeat = {
      workerId,
      heartbeatAt: now,
      ...(info.concurrency === undefined ? {} : { concurrency: info.concurrency }),
      ...(info.activeJobs === undefined ? {} : { activeJobs: info.activeJobs }),
    };

    this.heartbeats.set(workerId, heartbeat);
    return heartbeat;
  }

  /** True when the worker has a heartbeat inside the TTL. */
  isAlive(workerId: string, now: number = this.clock()): boolean {
    const heartbeat = this.heartbeats.get(workerId);
    if (!heartbeat) {
      return false;
    }
    return now - heartbeat.heartbeatAt < this.ttlMs;
  }

  get(workerId: string): WorkerHeartbeat | undefined {
    return this.heartbeats.get(workerId);
  }

  remove(workerId: string): boolean {
    return this.heartbeats.delete(workerId);
  }

  /** Live worker ids, sorted for stable reporting. */
  liveWorkers(now: number = this.clock()): string[] {
    return [...this.heartbeats.keys()]
      .filter((workerId) => this.isAlive(workerId, now))
      .sort();
  }

  /** Stale worker ids, sorted so callers can reclaim in a stable order. */
  staleWorkers(now: number = this.clock()): string[] {
    return [...this.heartbeats.keys()]
      .filter((workerId) => !this.isAlive(workerId, now))
      .sort();
  }

  snapshot(now: number = this.clock()): WorkerHeartbeatSnapshot {
    let liveWorkers = 0;
    let staleWorkers = 0;
    let activeJobs = 0;

    for (const [workerId, heartbeat] of this.heartbeats) {
      if (this.isAlive(workerId, now)) {
        liveWorkers += 1;
        activeJobs += heartbeat.activeJobs ?? 0;
      } else {
        staleWorkers += 1;
      }
    }

    return { ttlMs: this.ttlMs, liveWorkers, staleWorkers, activeJobs };
  }
}

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}
