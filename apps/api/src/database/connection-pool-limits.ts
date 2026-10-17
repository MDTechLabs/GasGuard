/**
 * Database connection pool limits (#1093).
 *
 * Pool sizing is read from the environment with validated defaults, and the
 * runtime limiter enforces the ceiling instead of trusting every caller to
 * behave. Connections that sit idle longer than the idle timeout are reported
 * for reclamation so the pool can shrink back towards its minimum.
 *
 * The limiter holds no timers and reads no clock unless one is injected.
 */

export interface PoolLimits {
  /** Hard ceiling on open connections. */
  maxConnections: number;
  /** Connections kept open even when idle. */
  minConnections: number;
  /** How long an idle connection may live before it is reclaimed. */
  idleTimeoutMs: number;
  /** How long a caller may wait for a connection before failing. */
  acquireTimeoutMs: number;
}

export const DEFAULT_POOL_LIMITS: PoolLimits = {
  maxConnections: 10,
  minConnections: 1,
  idleTimeoutMs: 30_000,
  acquireTimeoutMs: 5_000,
};

export class PoolLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolLimitError";
  }
}

export function validatePoolLimits(limits: PoolLimits): void {
  const keys: Array<keyof PoolLimits> = [
    "maxConnections",
    "minConnections",
    "idleTimeoutMs",
    "acquireTimeoutMs",
  ];

  for (const key of keys) {
    const value = limits[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new PoolLimitError(`pool limit ${key} must be a positive integer`);
    }
  }

  if (limits.minConnections > limits.maxConnections) {
    throw new PoolLimitError("minConnections cannot exceed maxConnections");
  }
}

/** Resolve limits from environment variables, ignoring blank values. */
export function resolvePoolLimits(
  env: Record<string, string | undefined> = {},
  defaults: PoolLimits = DEFAULT_POOL_LIMITS,
): PoolLimits {
  const limits: PoolLimits = {
    maxConnections: parsePositiveInt(env.DATABASE_POOL_MAX, defaults.maxConnections),
    minConnections: parsePositiveInt(env.DATABASE_POOL_MIN, defaults.minConnections),
    idleTimeoutMs: parsePositiveInt(env.DATABASE_POOL_IDLE_TIMEOUT_MS, defaults.idleTimeoutMs),
    acquireTimeoutMs: parsePositiveInt(env.DATABASE_POOL_ACQUIRE_TIMEOUT_MS, defaults.acquireTimeoutMs),
  };

  validatePoolLimits(limits);
  return limits;
}

export interface PoolStats {
  open: number;
  idle: number;
  active: number;
  maxConnections: number;
  minConnections: number;
}

interface OpenConnection {
  id: string;
  lastUsedAt: number;
}

export class ConnectionPoolLimiter {
  private readonly limits: PoolLimits;
  private readonly connections = new Map<string, OpenConnection>();
  private waited = 0;

  constructor(limits: PoolLimits = DEFAULT_POOL_LIMITS) {
    validatePoolLimits(limits);
    this.limits = limits;
  }

  /** Take a connection if the ceiling allows it; otherwise report back-pressure. */
  tryAcquire(connectionId: string, now: number = Date.now()): boolean {
    const existing = this.connections.get(connectionId);
    if (existing) {
      existing.lastUsedAt = now;
      return true;
    }

    if (this.connections.size >= this.limits.maxConnections) {
      this.waited += 1;
      return false;
    }

    this.connections.set(connectionId, { id: connectionId, lastUsedAt: now });
    return true;
  }

  release(connectionId: string, now: number = Date.now()): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }
    connection.lastUsedAt = now;
    return true;
  }

  /** Close one connection, refusing to drop below the configured minimum. */
  close(connectionId: string): boolean {
    if (this.connections.size <= this.limits.minConnections) {
      return false;
    }
    return this.connections.delete(connectionId);
  }

  /**
   * Connection ids idle beyond the idle timeout, above the minimum pool size.
   *
   * Deterministic: ordered by id so a caller reclaiming several connections
   * does so in the same order every time.
   */
  reclaimable(now: number = Date.now()): string[] {
    const idleBefore = now - this.limits.idleTimeoutMs;
    const candidates = [...this.connections.values()]
      .filter((connection) => connection.lastUsedAt <= idleBefore)
      .map((connection) => connection.id)
      .sort();

    const keep = Math.max(0, this.limits.minConnections - (this.connections.size - candidates.length));
    return candidates.slice(0, Math.max(0, candidates.length - keep));
  }

  /** Number of acquisitions rejected for back-pressure since construction. */
  waitedCount(): number {
    return this.waited;
  }

  stats(now: number = Date.now()): PoolStats {
    const idleBefore = now - this.limits.idleTimeoutMs;
    let idle = 0;
    for (const connection of this.connections.values()) {
      if (connection.lastUsedAt <= idleBefore) {
        idle += 1;
      }
    }

    return {
      open: this.connections.size,
      idle,
      active: this.connections.size - idle,
      maxConnections: this.limits.maxConnections,
      minConnections: this.limits.minConnections,
    };
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
