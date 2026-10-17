/**
 * Worker sharding for horizontal scaling (#1095).
 *
 * Worker processes are interchangeable, so any worker may pick up any scan.
 * What they must not do is process the same repository concurrently without
 * knowing about each other. Sharding by a stable hash of the repository id
 * keeps every scan of one repository on the same worker, which makes per-repo
 * ordering and quotas meaningful across a fleet.
 *
 * The hash is a deterministic FNV-1a variant with no dependencies, so every
 * worker computes the same assignment from the same inputs.
 */

export interface ShardPlan {
  workerIndex: number;
  repositories: string[];
}

export function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The worker index that owns `repositoryId` out of `workerCount` workers. */
export function shardFor(repositoryId: string, workerCount: number): number {
  requireNonEmpty(repositoryId, "repositoryId");
  requireWorkerCount(workerCount);
  return fnv1aHash(repositoryId) % workerCount;
}

/**
 * Distribute repositories across workers.
 *
 * Each repository appears exactly once, and a repository that hashes to a
 * worker stays there even if the input order changes.
 */
export function buildShardPlan(
  repositoryIds: readonly string[],
  workerCount: number,
): ShardPlan[] {
  requireWorkerCount(workerCount);
  const plan: ShardPlan[] = Array.from({ length: workerCount }, (_, workerIndex) => ({
    workerIndex,
    repositories: [],
  }));

  for (const repositoryId of [...repositoryIds].sort()) {
    plan[shardFor(repositoryId, workerCount)].repositories.push(repositoryId);
  }

  return plan;
}

/** Index of the worker that should handle the next scan for a repository. */
export function shardForScan(
  scanId: string,
  repositoryId: string,
  workerCount: number,
): number {
  return shardFor(`${repositoryId}:${scanId}`, workerCount);
}

function requireWorkerCount(workerCount: number): void {
  if (!Number.isInteger(workerCount) || workerCount <= 0) {
    throw new RangeError("workerCount must be a positive integer");
  }
}

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}
