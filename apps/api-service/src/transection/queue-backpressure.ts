/**
 * Queue backpressure controls.
 *
 * Prevents unbounded memory growth and runaway acceptance of work items when
 * consumers are slower than producers. The controller tracks queue depth,
 * enforces configurable high/low watermarks, and exposes a clear
 * accept/reject/drain interface so callers never need to inspect raw queue
 * length to decide whether to enqueue.
 *
 * Design
 * ──────
 * - No I/O, no timers, no global state — pure data structure.
 * - Tenant-isolated: one `QueueBackpressureController` instance per logical
 *   queue; state never leaks across requests.
 * - Secure defaults: `DEFAULT_BACKPRESSURE_OPTIONS` are conservative.
 * - Deterministic: given the same sequence of operations the pressure level
 *   and accept/reject decisions are always the same.
 * - Priority-aware: the same four-level priority scheme used by
 *   `WithdrawalQueueService` (critical > high > medium > low) is honoured;
 *   items at higher priorities are still accepted when lower priorities are
 *   shedding load.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type BackpressurePriority = "critical" | "high" | "medium" | "low";

export type BackpressureLevel =
  /** Below highWatermark — all priorities accepted. */
  | "normal"
  /** At or above highWatermark — low/medium priorities shed. */
  | "pressure"
  /** At or above criticalWatermark — only critical items accepted. */
  | "critical"
  /** At maxQueueDepth — all items rejected. */
  | "overloaded";

export interface BackpressureOptions {
  /**
   * Maximum number of items allowed in the queue at any time.
   * Enqueueing above this always fails regardless of priority.
   */
  maxQueueDepth: number;
  /**
   * Depth at which `low` and `medium` items start being rejected.
   * Must be < criticalWatermark < maxQueueDepth.
   */
  highWatermark: number;
  /**
   * Depth at which only `critical` items are accepted.
   * Must be > highWatermark and <= maxQueueDepth.
   */
  criticalWatermark: number;
  /**
   * When true, the drain() method will not resume acceptance until the queue
   * depth drops to or below `drainToDepth`.
   */
  drainEnabled: boolean;
  /**
   * The target depth that draining must reach before normal acceptance resumes.
   * Only consulted when `drainEnabled` is true.  Defaults to half highWatermark.
   */
  drainToDepth?: number;
}

export const DEFAULT_BACKPRESSURE_OPTIONS: Readonly<BackpressureOptions> = {
  maxQueueDepth: 1000,
  highWatermark: 700,
  criticalWatermark: 900,
  drainEnabled: true,
  drainToDepth: 350,
};

export interface BackpressureDecision {
  accepted: boolean;
  level: BackpressureLevel;
  /** Human-readable reason when `accepted` is false. */
  reason?: string;
  /** Current depth at the time of the decision. */
  depth: number;
}

export interface BackpressureMetrics {
  depth: number;
  level: BackpressureLevel;
  accepted: number;
  rejected: number;
  /** Total number of dequeue operations that brought depth down. */
  dequeued: number;
  /** True when a drain cycle is currently in progress. */
  draining: boolean;
  highWatermarkBreaches: number;
  criticalWatermarkBreaches: number;
  overloadEvents: number;
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * Stateful backpressure controller.  Wire one instance to each logical queue.
 *
 * Usage
 * -----
 *   const bp = new QueueBackpressureController(options);
 *
 *   // Producer side:
 *   const decision = bp.tryEnqueue("medium");
 *   if (!decision.accepted) { ...shed load... }
 *
 *   // Consumer side (called once per item processed):
 *   bp.dequeue();
 */
export class QueueBackpressureController {
  private depth = 0;
  private draining = false;

  private accepted = 0;
  private rejected = 0;
  private dequeued = 0;
  private highWatermarkBreaches = 0;
  private criticalWatermarkBreaches = 0;
  private overloadEvents = 0;

  private readonly opts: Readonly<BackpressureOptions>;

  constructor(options: Partial<BackpressureOptions> = {}) {
    const merged: BackpressureOptions = {
      ...DEFAULT_BACKPRESSURE_OPTIONS,
      ...options,
    };

    if (merged.highWatermark >= merged.criticalWatermark) {
      throw new Error(
        `highWatermark (${merged.highWatermark}) must be less than criticalWatermark (${merged.criticalWatermark})`,
      );
    }
    if (merged.criticalWatermark > merged.maxQueueDepth) {
      throw new Error(
        `criticalWatermark (${merged.criticalWatermark}) must not exceed maxQueueDepth (${merged.maxQueueDepth})`,
      );
    }
    if (merged.drainToDepth !== undefined && merged.drainToDepth >= merged.highWatermark) {
      throw new Error(
        `drainToDepth (${merged.drainToDepth}) must be less than highWatermark (${merged.highWatermark})`,
      );
    }

    this.opts = Object.freeze(merged);
  }

  // ── Public interface ──────────────────────────────────────────────────────

  /**
   * Evaluates whether the queue can accept an item at the given priority and,
   * if so, increments the internal depth counter.
   *
   * Call `dequeue()` for every item removed from the queue so depth stays
   * accurate.
   */
  tryEnqueue(priority: BackpressurePriority = "medium"): BackpressureDecision {
    const level = this.computeLevel();

    const accepted = this.isAccepted(priority, level);

    if (accepted) {
      this.depth++;
      this.accepted++;
      // Track watermark breaches on the way up.
      if (this.depth === this.opts.highWatermark + 1) this.highWatermarkBreaches++;
      if (this.depth === this.opts.criticalWatermark + 1) this.criticalWatermarkBreaches++;
      if (this.depth > this.opts.maxQueueDepth) this.overloadEvents++;
    } else {
      this.rejected++;
    }

    return {
      accepted,
      level,
      reason: accepted ? undefined : this.rejectionReason(priority, level),
      depth: this.depth,
    };
  }

  /**
   * Signals that one item has been consumed from the queue.
   *
   * Decrements the depth counter (floor: 0) and, when drain mode is enabled,
   * clears the draining flag once the target depth is reached.
   */
  dequeue(count = 1): void {
    const n = Math.max(0, count);
    this.depth = Math.max(0, this.depth - n);
    this.dequeued += n;

    if (this.draining && this.opts.drainEnabled) {
      const target = this.opts.drainToDepth ?? Math.floor(this.opts.highWatermark / 2);
      if (this.depth <= target) {
        this.draining = false;
      }
    }
  }

  /**
   * Activates drain mode.
   *
   * When drain mode is active and `drainEnabled` is true, only `critical`
   * items are accepted until the depth falls to `drainToDepth`.
   */
  drain(): void {
    if (this.opts.drainEnabled) {
      this.draining = true;
    }
  }

  /**
   * Resets all counters and depth to zero.  Useful for test isolation and
   * scheduled maintenance windows.
   */
  reset(): void {
    this.depth = 0;
    this.draining = false;
    this.accepted = 0;
    this.rejected = 0;
    this.dequeued = 0;
    this.highWatermarkBreaches = 0;
    this.criticalWatermarkBreaches = 0;
    this.overloadEvents = 0;
  }

  /** Returns a snapshot of current metrics. */
  getMetrics(): BackpressureMetrics {
    return {
      depth: this.depth,
      level: this.computeLevel(),
      accepted: this.accepted,
      rejected: this.rejected,
      dequeued: this.dequeued,
      draining: this.draining,
      highWatermarkBreaches: this.highWatermarkBreaches,
      criticalWatermarkBreaches: this.criticalWatermarkBreaches,
      overloadEvents: this.overloadEvents,
    };
  }

  /** Current queue depth. */
  get currentDepth(): number {
    return this.depth;
  }

  /** Current backpressure level. */
  get level(): BackpressureLevel {
    return this.computeLevel();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private computeLevel(): BackpressureLevel {
    if (this.draining && this.opts.drainEnabled) {
      // While draining treat as critical so only critical items sneak through.
      return "critical";
    }
    if (this.depth >= this.opts.maxQueueDepth) return "overloaded";
    if (this.depth >= this.opts.criticalWatermark) return "critical";
    if (this.depth >= this.opts.highWatermark) return "pressure";
    return "normal";
  }

  private isAccepted(priority: BackpressurePriority, level: BackpressureLevel): boolean {
    switch (level) {
      case "normal":
        return true;
      case "pressure":
        // Accept critical and high; shed medium and low.
        return priority === "critical" || priority === "high";
      case "critical":
        // Accept only critical items.
        return priority === "critical";
      case "overloaded":
        return false;
    }
  }

  private rejectionReason(
    priority: BackpressurePriority,
    level: BackpressureLevel,
  ): string {
    switch (level) {
      case "overloaded":
        return `Queue is at maximum capacity (${this.opts.maxQueueDepth}). All new items are rejected.`;
      case "critical":
        return (
          `Queue has reached the critical watermark (${this.opts.criticalWatermark}). ` +
          `Only 'critical' priority items are accepted; '${priority}' was rejected.`
        );
      case "pressure":
        return (
          `Queue is under pressure (depth ${this.depth} ≥ highWatermark ${this.opts.highWatermark}). ` +
          `'${priority}' priority items are shed; only 'critical' and 'high' are accepted.`
        );
      default:
        return `Item rejected at level '${level}'.`;
    }
  }
}
