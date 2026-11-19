/**
 * Per-stage resource limits for analyzer stages (#1347).
 *
 * `runWithStageLimits` runs one analyzer stage and enforces a wall-clock
 * deadline (a timer that rejects the stage) plus CPU and heap budgets that are
 * sampled while the stage runs and checked once more when it finishes.
 *
 * Limitations: a synchronous, non-yielding stage cannot be interrupted from
 * inside the same thread, so hard preemption requires running the stage in the
 * worker pool (`scanner-worker.pool.ts`); this helper is the budget policy.
 */

export interface StageLimits {
  wallClockMs: number;
  cpuMs: number;
  /** Maximum heap growth in bytes while the stage runs. */
  memoryBytes: number;
}

export type StageLimitKind = "wall_clock" | "cpu" | "memory";

export class StageLimitError extends Error {
  constructor(
    readonly stage: string,
    readonly kind: StageLimitKind,
    message: string,
  ) {
    super(message);
    this.name = "StageLimitError";
  }
}

export const DEFAULT_STAGE_LIMITS: StageLimits = {
  wallClockMs: 60_000,
  cpuMs: 30_000,
  memoryBytes: 512 * 1024 * 1024,
};

export async function runWithStageLimits<T>(
  stage: string,
  fn: () => Promise<T> | T,
  limits: Partial<StageLimits> = {},
  sampleMs = 100,
): Promise<T> {
  const cfg = { ...DEFAULT_STAGE_LIMITS, ...limits };
  for (const [key, value] of Object.entries(cfg)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${key} must be a positive number`);
    }
  }

  const cpuStart = process.cpuUsage();
  const heapStart = process.memoryUsage().heapUsed;
  const check = (): StageLimitError | undefined => {
    const cpu = process.cpuUsage(cpuStart);
    if ((cpu.user + cpu.system) / 1000 > cfg.cpuMs) {
      return new StageLimitError(stage, "cpu", `stage ${stage} exceeded CPU budget of ${cfg.cpuMs}ms`);
    }
    if (process.memoryUsage().heapUsed - heapStart > cfg.memoryBytes) {
      return new StageLimitError(stage, "memory", `stage ${stage} exceeded memory budget of ${cfg.memoryBytes} bytes`);
    }
    return undefined;
  };

  let wallTimer: NodeJS.Timeout | undefined;
  let sampler: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    wallTimer = setTimeout(
      () => reject(new StageLimitError(stage, "wall_clock", `stage ${stage} exceeded wall-clock limit of ${cfg.wallClockMs}ms`)),
      cfg.wallClockMs,
    );
    sampler = setInterval(() => {
      const violation = check();
      if (violation) reject(violation);
    }, sampleMs);
  });

  try {
    const result = await Promise.race([Promise.resolve().then(fn), guard]);
    const violation = check();
    if (violation) throw violation;
    return result;
  } finally {
    clearTimeout(wallTimer);
    clearInterval(sampler);
  }
}
