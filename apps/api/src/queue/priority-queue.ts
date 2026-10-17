/**
 * Job priority queue.
 *
 * Scans are not equally urgent: a blocking CI check should not wait behind a
 * nightly full-repository audit. The queue orders work by priority and keeps
 * lower priorities from starving through aging.
 *
 *  - Four levels: critical, high, normal (default), low.
 *  - Within a level, jobs leave in the order they arrived (FIFO).
 *  - Aging: every `agingMs` a job has waited promotes it one level. Its
 *    effective level never goes above critical, and a promoted job competes
 *    with the other jobs at that level by arrival order. A low job therefore
 *    waits at most about 3 x agingMs before it is ahead of any newer job.
 *  - Each level has its own capacity, so a flood of low-priority work can
 *    never block a critical job from being accepted (backpressure is per level).
 *  - `resolveJobPriority` clamps caller-requested priorities to a ceiling,
 *    so critical stays reserved for internal callers by default.
 *
 * The class performs no I/O and never reads the clock itself; callers pass
 * `now`, so ordering is deterministic and testable.
 */

export const JOB_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const DEFAULT_JOB_PRIORITY: JobPriority = "normal";

/** Highest priority an untrusted caller may request unless told otherwise. */
export const DEFAULT_PRIORITY_CEILING: JobPriority = "high";

const MAX_ID_LENGTH = 256;

const RANK: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface PriorityQueueConfig {
  /** Maximum queued jobs per priority level. */
  maxSizePerPriority: number;
  /** Waiting time after which a job is promoted one level. */
  agingMs: number;
}

export const DEFAULT_PRIORITY_QUEUE_CONFIG: PriorityQueueConfig = {
  maxSizePerPriority: 10_000,
  agingMs: 30_000,
};

export interface EnqueueOptions {
  priority?: JobPriority;
}

export type EnqueueResult =
  | { accepted: true; priority: JobPriority }
  | { accepted: false; reason: "duplicate" | "queue_full" };

export interface QueuedJob<T> {
  id: string;
  payload: T;
  /** Priority the job was enqueued with. */
  priority: JobPriority;
  /** Priority it is competing at now, after aging. */
  effectivePriority: JobPriority;
  enqueuedAt: number;
  waitedMs: number;
}

export interface PriorityQueueStats {
  enqueued: number;
  dequeued: number;
  removed: number;
  rejectedDuplicate: number;
  rejectedFull: number;
  /** Jobs that left the queue ahead of their original level because of aging. */
  promoted: number;
}

interface Entry<T> {
  id: string;
  payload: T;
  rank: number;
  enqueuedAt: number;
  seq: number;
  removed: boolean;
}

interface Level<T> {
  items: Entry<T>[];
  head: number;
  live: number;
}

/** Compact a level's backing array once at least half of it is consumed. */
const COMPACT_MIN_HEAD = 64;

export class JobPriorityQueue<T> {
  private readonly config: PriorityQueueConfig;
  private readonly levels: Level<T>[] = JOB_PRIORITIES.map(() => ({ items: [], head: 0, live: 0 }));
  private readonly byId: Map<string, Entry<T>> = new Map();
  private seq = 0;
  private readonly counters: PriorityQueueStats = {
    enqueued: 0,
    dequeued: 0,
    removed: 0,
    rejectedDuplicate: 0,
    rejectedFull: 0,
    promoted: 0,
  };

  constructor(config: Partial<PriorityQueueConfig> = {}) {
    this.config = { ...DEFAULT_PRIORITY_QUEUE_CONFIG, ...config };
    requirePositiveInteger(this.config.maxSizePerPriority, "maxSizePerPriority");
    requirePositiveInteger(this.config.agingMs, "agingMs");
  }

  /**
   * Add a job. Returns a rejection instead of throwing when the queue cannot
   * take it (duplicate id, or the level is full) so callers can apply backpressure.
   * Invalid arguments throw.
   */
  enqueue(
    id: string,
    payload: T,
    options: EnqueueOptions = {},
    now: number = Date.now(),
  ): EnqueueResult {
    requireId(id);
    requireFinite(now, "now");
    const priority = options.priority ?? DEFAULT_JOB_PRIORITY;
    requirePriority(priority);

    if (this.byId.has(id)) {
      this.counters.rejectedDuplicate += 1;
      return { accepted: false, reason: "duplicate" };
    }
    const level = this.levels[RANK[priority]];
    if (level.live >= this.config.maxSizePerPriority) {
      this.counters.rejectedFull += 1;
      return { accepted: false, reason: "queue_full" };
    }

    const entry: Entry<T> = {
      id,
      payload,
      rank: RANK[priority],
      enqueuedAt: now,
      seq: this.seq++,
      removed: false,
    };
    level.items.push(entry);
    level.live += 1;
    this.byId.set(id, entry);
    this.counters.enqueued += 1;
    return { accepted: true, priority };
  }

  /** Remove and return the next job to run, or undefined when empty. */
  dequeue(now: number = Date.now()): QueuedJob<T> | undefined {
    requireFinite(now, "now");
    const entry = this.next(now);
    if (!entry) {
      return undefined;
    }
    const level = this.levels[entry.rank];
    level.head += 1;
    level.live -= 1;
    this.byId.delete(entry.id);
    this.compact(level);

    this.counters.dequeued += 1;
    const view = this.view(entry, now);
    if (RANK[view.effectivePriority] < entry.rank) {
      this.counters.promoted += 1;
    }
    return view;
  }

  /** The job `dequeue` would return, without removing it. */
  peek(now: number = Date.now()): QueuedJob<T> | undefined {
    requireFinite(now, "now");
    const entry = this.next(now);
    return entry ? this.view(entry, now) : undefined;
  }

  /** Cancel a queued job. Returns whether it was queued. */
  remove(id: string): boolean {
    const entry = this.byId.get(id);
    if (!entry) {
      return false;
    }
    entry.removed = true;
    this.byId.delete(id);
    const level = this.levels[entry.rank];
    level.live -= 1;
    this.counters.removed += 1;
    this.purge(level);
    return true;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  size(): number {
    return this.byId.size;
  }

  sizeByPriority(): Record<JobPriority, number> {
    const sizes = {} as Record<JobPriority, number>;
    for (const priority of JOB_PRIORITIES) {
      sizes[priority] = this.levels[RANK[priority]].live;
    }
    return sizes;
  }

  /**
   * Enqueue time of the longest-waiting job, for `QueueAgeSlo.evaluate`.
   * Undefined when the queue is empty.
   */
  oldestEnqueuedAt(): number | undefined {
    let oldest: number | undefined;
    for (const level of this.levels) {
      const head = this.headOf(level);
      if (head && (oldest === undefined || head.enqueuedAt < oldest)) {
        oldest = head.enqueuedAt;
      }
    }
    return oldest;
  }

  stats(): PriorityQueueStats {
    return { ...this.counters };
  }

  /**
   * The entry to run next: lowest effective level wins, and entries at the same
   * effective level go in arrival order. Only each level's head is considered,
   * because within a level the head is the oldest and so the most aged.
   */
  private next(now: number): Entry<T> | undefined {
    let best: Entry<T> | undefined;
    let bestRank = Infinity;
    for (const level of this.levels) {
      const head = this.headOf(level);
      if (!head) {
        continue;
      }
      const rank = this.effectiveRank(head, now);
      if (rank < bestRank || (rank === bestRank && best !== undefined && head.seq < best.seq)) {
        best = head;
        bestRank = rank;
      }
    }
    return best;
  }

  private headOf(level: Level<T>): Entry<T> | undefined {
    while (level.head < level.items.length && level.items[level.head].removed) {
      level.head += 1;
    }
    return level.items[level.head];
  }

  private compact(level: Level<T>): void {
    if (level.head >= COMPACT_MIN_HEAD && level.head * 2 >= level.items.length) {
      level.items.splice(0, level.head);
      level.head = 0;
    }
  }

  /** Drop cancelled entries once they outnumber live ones, bounding memory under churn. */
  private purge(level: Level<T>): void {
    const pending = level.items.length - level.head;
    if (pending > 2 * level.live + COMPACT_MIN_HEAD) {
      level.items = level.items.slice(level.head).filter((entry) => !entry.removed);
      level.head = 0;
    }
  }

  private effectiveRank(entry: Entry<T>, now: number): number {
    const waited = Math.max(0, now - entry.enqueuedAt);
    return Math.max(0, entry.rank - Math.floor(waited / this.config.agingMs));
  }

  private view(entry: Entry<T>, now: number): QueuedJob<T> {
    return {
      id: entry.id,
      payload: entry.payload,
      priority: JOB_PRIORITIES[entry.rank],
      effectivePriority: JOB_PRIORITIES[this.effectiveRank(entry, now)],
      enqueuedAt: entry.enqueuedAt,
      waitedMs: Math.max(0, now - entry.enqueuedAt),
    };
  }
}

export function isJobPriority(value: unknown): value is JobPriority {
  return typeof value === "string" && (JOB_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Priority to use for a request. Missing means the default; an unrecognised
 * value is an error (never silently promoted); anything above `ceiling` is
 * lowered to it.
 */
export function resolveJobPriority(
  requested: unknown,
  ceiling: JobPriority = DEFAULT_PRIORITY_CEILING,
): JobPriority {
  requirePriority(ceiling);
  if (requested === undefined || requested === null) {
    return RANK[DEFAULT_JOB_PRIORITY] < RANK[ceiling] ? ceiling : DEFAULT_JOB_PRIORITY;
  }
  if (!isJobPriority(requested)) {
    throw new TypeError(`priority must be one of: ${JOB_PRIORITIES.join(", ")}`);
  }
  return RANK[requested] < RANK[ceiling] ? ceiling : requested;
}

/** BullMQ job priority: 1 is the highest, larger numbers run later. */
export function toBullMqPriority(priority: JobPriority): number {
  requirePriority(priority);
  return RANK[priority] + 1;
}

function requirePriority(priority: unknown): asserts priority is JobPriority {
  if (!isJobPriority(priority)) {
    throw new TypeError(`priority must be one of: ${JOB_PRIORITIES.join(", ")}`);
  }
}

function requireId(id: unknown): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("id must be a non-empty string");
  }
  if (id.length > MAX_ID_LENGTH) {
    throw new RangeError(`id must be at most ${MAX_ID_LENGTH} characters`);
  }
}

function requireFinite(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}
