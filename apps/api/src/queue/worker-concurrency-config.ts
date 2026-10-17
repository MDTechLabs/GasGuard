/**
 * Worker concurrency configuration (#1088).
 *
 * Concurrency has to be tunable per deployment but must never let a single
 * worker exhaust the host. The resolver reads `WORKER_CONCURRENCY` when it is
 * set and otherwise derives a default from the CPU count, then clamps the
 * result into a safe band. Invalid values fall back to the derived default
 * rather than silently taking down the worker.
 *
 * Everything here is pure: the caller supplies the environment and CPU count.
 */

export interface WorkerConcurrencyConfig {
  /** Jobs one worker processes at the same time. */
  concurrency: number;
  /** Lower bound applied to any configured value. */
  minConcurrency: number;
  /** Upper bound applied to any configured value. */
  maxConcurrency: number;
  /** Concurrent jobs a single repository may occupy. */
  perRepositoryLimit: number;
  /** Where the value came from, for logs and startup diagnostics. */
  source: "environment" | "derived";
}

export const DEFAULT_WORKER_CONCURRENCY: Omit<WorkerConcurrencyConfig, "concurrency" | "source"> = {
  minConcurrency: 1,
  maxConcurrency: 16,
  perRepositoryLimit: 2,
};

export class WorkerConcurrencyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConcurrencyConfigError";
  }
}

/** Default concurrency for a host: one job per CPU, clamped to the band. */
export function derivedConcurrency(
  cpuCount: number,
  limits: Pick<WorkerConcurrencyConfig, "minConcurrency" | "maxConcurrency"> = DEFAULT_WORKER_CONCURRENCY,
): number {
  if (!Number.isInteger(cpuCount) || cpuCount <= 0) {
    throw new WorkerConcurrencyConfigError("cpuCount must be a positive integer");
  }
  return clamp(cpuCount, limits.minConcurrency, limits.maxConcurrency);
}

export function resolveWorkerConcurrency(
  env: Record<string, string | undefined> = {},
  cpuCount = 1,
  overrides: Partial<Omit<WorkerConcurrencyConfig, "concurrency" | "source">> = {},
): WorkerConcurrencyConfig {
  const limits = { ...DEFAULT_WORKER_CONCURRENCY, ...overrides };
  validateLimits(limits);

  const derived = derivedConcurrency(cpuCount, limits);
  const raw = env.WORKER_CONCURRENCY?.trim();

  if (!raw) {
    return { ...limits, concurrency: derived, source: "derived" };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ...limits, concurrency: derived, source: "derived" };
  }

  return {
    ...limits,
    concurrency: clamp(parsed, limits.minConcurrency, limits.maxConcurrency),
    source: "environment",
  };
}

/** Split the worker's slots across named queues, largest remainders first. */
export function distributeConcurrency(
  concurrency: number,
  queueWeights: Record<string, number>,
): Record<string, number> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new WorkerConcurrencyConfigError("concurrency must be a positive integer");
  }

  const entries = Object.entries(queueWeights).sort(([left], [right]) =>
    left < right ? -1 : 1,
  );
  if (entries.length === 0) {
    return {};
  }

  const totalWeight = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (totalWeight <= 0) {
    throw new WorkerConcurrencyConfigError("queueWeights must contain a positive weight");
  }

  const allocation: Record<string, number> = {};
  let assigned = 0;
  const remainders: Array<{ queue: string; remainder: number }> = [];

  for (const [queue, weight] of entries) {
    const exact = (concurrency * Math.max(0, weight)) / totalWeight;
    const whole = Math.floor(exact);
    allocation[queue] = whole;
    assigned += whole;
    remainders.push({ queue, remainder: exact - whole });
  }

  remainders.sort((left, right) => right.remainder - left.remainder || (left.queue < right.queue ? -1 : 1));
  for (const { queue } of remainders) {
    if (assigned >= concurrency) {
      break;
    }
    allocation[queue] += 1;
    assigned += 1;
  }

  return allocation;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validateLimits(limits: {
  minConcurrency: number;
  maxConcurrency: number;
  perRepositoryLimit: number;
}): void {
  if (!Number.isInteger(limits.minConcurrency) || limits.minConcurrency < 1) {
    throw new WorkerConcurrencyConfigError("minConcurrency must be a positive integer");
  }
  if (!Number.isInteger(limits.maxConcurrency) || limits.maxConcurrency < limits.minConcurrency) {
    throw new WorkerConcurrencyConfigError("maxConcurrency must be >= minConcurrency");
  }
  if (!Number.isInteger(limits.perRepositoryLimit) || limits.perRepositoryLimit < 1) {
    throw new WorkerConcurrencyConfigError("perRepositoryLimit must be a positive integer");
  }
}
