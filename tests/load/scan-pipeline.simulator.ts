/**
 * Scan pipeline load simulator.
 *
 * Drives the real reliability primitives of the scan queue (deduplication,
 * per-repository quotas, leases with fencing tokens, checkpoints, queue-age
 * SLO) from a pool of simulated workers, in virtual time, with injected faults.
 * Only the clock, the job bodies and the faults are simulated; every admission,
 * lease and checkpoint decision is made by production code.
 *
 * The simulator never throws on a broken invariant. It records a violation and
 * keeps going, so one run reports everything that went wrong. Same config and
 * seed always produce a byte-identical report.
 */

import { QueueAgeSlo, QueueAgeSloConfig } from "../../apps/api/src/queue/queue-age-slo";
import { ScanCheckpointStore } from "../../apps/api/src/queue/scan-checkpoint";
import { ScanDeduplicator } from "../../apps/api/src/queue/scan-dedup";
import { ScanLeaseManager } from "../../apps/api/src/queue/scan-lease";
import { RepositoryScanQuota, ScanQuotaConfig } from "../../apps/api/src/queue/scan-quota";
import { Rng } from "./harness/prng";
import { EventScheduler } from "./harness/scheduler";
import { LatencySummary, summarize } from "./harness/stats";

export interface TenantProfile {
  repositoryId: string;
  /** Mean Poisson arrival rate, scans per second. 0 disables steady arrivals. */
  ratePerSec: number;
  /** `noisy` tenants are excluded from the "quiet tenant" latency figures. */
  role?: "normal" | "noisy";
  /** A one-off spike of scans. */
  burst?: { atMs: number; count: number; spreadMs: number };
  /** Every attempt fails: exercises retry exhaustion and the dead-letter path. */
  poison?: boolean;
}

export interface SimulationConfig {
  name: string;
  seed: number;
  workers: number;
  /** New scans are accepted until this time; the run then drains. */
  arrivalWindowMs: number;
  tenants: TenantProfile[];
  service: {
    minMs: number;
    maxMs: number;
    /** Checkpointable units per scan. */
    items: number;
    /** A checkpoint is saved every N completed items. */
    checkpointEvery: number;
  };
  leaseTtlMs: number;
  reaperIntervalMs: number;
  sampleIntervalMs: number;
  quota: Partial<ScanQuotaConfig>;
  queueAge: QueueAgeSloConfig;
  retry: { maxAttempts: number; backoffMs: number; multiplier: number };
  faults: {
    /** Worker dies mid-scan; its lease must expire and the scan be reclaimed. */
    crashRate: number;
    /** Worker freezes past its lease, then wakes as a "zombie" holding a stale token. */
    stallRate: number;
    /** Scan throws; it is retried with exponential backoff. */
    failRate: number;
    /** Chance a submission is re-sent, 1..maxDuplicates times. */
    duplicateRate: number;
    maxDuplicates: number;
    workerRestartMs: number;
    stallMs: number;
  };
  /** Safety valve against runaway runs. Default 5,000,000. */
  maxEvents?: number;
  /** Check invariants after every event (default true). */
  checkInvariants?: boolean;
}

export interface TenantReport {
  submitted: number;
  completed: number;
  deadLettered: number;
  wait: LatencySummary;
  maxInFlight: number;
}

export interface LoadReport {
  scenario: string;
  seed: number;
  /** Virtual time at which the run fully drained. */
  drainedAtMs: number;
  events: number;
  submitted: number;
  deduplicated: number;
  uniqueScans: number;
  completed: number;
  deadLettered: number;
  retries: number;
  crashes: number;
  stalls: number;
  /** Stale-token workers refused by the lease manager. */
  fencedOut: number;
  reaped: number;
  quotaRejections: { concurrency: number; window: number };
  /** Items re-executed after an interruption (work lost between checkpoints). */
  replayedItems: number;
  maxQueueDepth: number;
  maxInFlightPerRepository: number;
  workerUtilization: number;
  throughputPerSec: number;
  /** Submission to first start, all tenants. */
  wait: LatencySummary;
  /** Submission to first start, `normal` tenants only. */
  quietWait: LatencySummary;
  endToEnd: LatencySummary;
  queueAge: {
    samples: number;
    healthy: number;
    warning: number;
    breached: number;
    worstAgeMs: number;
    compliance: number;
  };
  perTenant: Record<string, TenantReport>;
  /** Broken invariants. A healthy run has none. */
  violations: string[];
}

interface Job {
  scanId: string;
  repositoryId: string;
  arrivedAt: number;
  queuedAt: number;
  seq: number;
  attempts: number;
  itemMs: number;
  poison: boolean;
  firstStartedAt?: number;
}

type FaultKind = "none" | "crash" | "stall" | "fail";

interface Attempt {
  id: number;
  job: Job;
  worker: Worker;
  token: number;
  nextItem: number;
  fault: FaultKind;
  faultAtItem: number;
  state: "running" | "crashed" | "stalled";
}

interface Worker {
  id: string;
  busy: boolean;
  deadUntil: number;
  busySince: number;
}

const MAX_VIOLATIONS = 50;
const DEFAULT_MAX_EVENTS = 5_000_000;

export function validateSimulationConfig(config: SimulationConfig): void {
  const fail = (message: string): never => {
    throw new RangeError(`invalid simulation config: ${message}`);
  };
  const positiveInt = (value: number, field: string) => {
    if (!Number.isInteger(value) || value <= 0) fail(`${field} must be a positive integer`);
  };
  const rate = (value: number, field: string) => {
    if (!(value >= 0 && value <= 1)) fail(`${field} must be within [0, 1]`);
  };

  positiveInt(config.workers, "workers");
  positiveInt(config.arrivalWindowMs, "arrivalWindowMs");
  positiveInt(config.service.items, "service.items");
  positiveInt(config.service.minMs, "service.minMs");
  positiveInt(config.leaseTtlMs, "leaseTtlMs");
  positiveInt(config.reaperIntervalMs, "reaperIntervalMs");
  positiveInt(config.sampleIntervalMs, "sampleIntervalMs");
  positiveInt(config.retry.maxAttempts, "retry.maxAttempts");
  if (!Number.isInteger(config.retry.backoffMs) || config.retry.backoffMs < 0) {
    fail("retry.backoffMs must be a non-negative integer");
  }
  if (!(config.retry.multiplier >= 1) || !Number.isFinite(config.retry.multiplier)) {
    fail("retry.multiplier must be >= 1");
  }
  if (config.service.maxMs < config.service.minMs) fail("service.maxMs must be >= service.minMs");
  if (
    !Number.isInteger(config.service.checkpointEvery) ||
    config.service.checkpointEvery < 1 ||
    config.service.checkpointEvery > config.service.items
  ) {
    fail("service.checkpointEvery must be between 1 and service.items");
  }
  // A healthy worker renews once per item, so an item must fit well inside the TTL.
  if (Math.ceil(config.service.maxMs / config.service.items) * 2 > config.leaseTtlMs) {
    fail("leaseTtlMs must be at least twice the longest item duration");
  }
  rate(config.faults.crashRate, "faults.crashRate");
  rate(config.faults.stallRate, "faults.stallRate");
  rate(config.faults.failRate, "faults.failRate");
  rate(config.faults.duplicateRate, "faults.duplicateRate");
  if (config.faults.crashRate + config.faults.stallRate + config.faults.failRate > 1) {
    fail("crashRate + stallRate + failRate must not exceed 1");
  }
  if (config.faults.stallMs <= config.leaseTtlMs) fail("faults.stallMs must exceed leaseTtlMs");
  if (config.tenants.length === 0) fail("at least one tenant is required");
  const seen = new Set<string>();
  for (const tenant of config.tenants) {
    if (!tenant.repositoryId) fail("tenant.repositoryId is required");
    if (seen.has(tenant.repositoryId)) fail(`duplicate tenant ${tenant.repositoryId}`);
    seen.add(tenant.repositoryId);
    if (!(tenant.ratePerSec >= 0) || !Number.isFinite(tenant.ratePerSec)) {
      fail(`tenant ${tenant.repositoryId} ratePerSec must be >= 0`);
    }
  }
}

export class ScanPipelineSimulation {
  private readonly cfg: SimulationConfig;
  private readonly sched = new EventScheduler();
  private readonly rng: Rng;
  private readonly arrivalRng = new Map<string, Rng>();
  private readonly serviceRng: Rng;
  private readonly faultRng: Rng;

  private readonly dedup = new ScanDeduplicator();
  private readonly quota: RepositoryScanQuota;
  private readonly quotaLimits: Required<Pick<ScanQuotaConfig, "maxConcurrentPerRepository" | "maxScansPerWindow" | "windowMs">>;
  private readonly leases: ScanLeaseManager;
  private readonly checkpoints = new ScanCheckpointStore();
  private readonly slo: QueueAgeSlo;

  private readonly workers: Worker[];
  private readonly queues = new Map<string, Job[]>();
  private readonly running = new Map<string, Attempt>();
  private readonly latestToken = new Map<string, number>();
  private readonly completions = new Map<string, number>();
  private readonly executions = new Map<string, number>();
  private readonly admissions = new Map<string, number[]>();
  private readonly wakeAt = new Map<string, number>();
  private readonly shaCounter = new Map<string, number>();
  private readonly tenantByRepo = new Map<string, TenantProfile>();

  private seq = 0;
  private scanSeq = 0;
  private attemptSeq = 0;
  private queued = 0;
  private arrivalsPending = 0;
  private retryPending = 0;
  private violationCount = 0;
  private readonly violations: string[] = [];

  private submitted = 0;
  private deduplicated = 0;
  private uniqueScans = 0;
  private completed = 0;
  private retries = 0;
  private crashes = 0;
  private stalls = 0;
  private failures = 0;
  private fencedOut = 0;
  private reaped = 0;
  private maxQueueDepth = 0;
  private busyMsTotal = 0;
  private lastCompletionAt = 0;
  private readonly rejections = { concurrency: 0, window: 0 };
  private readonly deadLetters: string[] = [];
  private readonly deadLettersByRepo = new Map<string, number>();
  private readonly submittedByRepo = new Map<string, number>();
  private readonly completedByRepo = new Map<string, number>();
  private readonly waitByRepo = new Map<string, number[]>();
  private readonly maxInFlightByRepo = new Map<string, number>();
  private readonly endToEnd: number[] = [];
  private readonly ageSamples = { samples: 0, healthy: 0, warning: 0, breached: 0, worstAgeMs: 0 };

  constructor(config: SimulationConfig) {
    validateSimulationConfig(config);
    this.cfg = config;
    this.rng = new Rng(config.seed);
    this.serviceRng = this.rng.fork("service");
    this.faultRng = this.rng.fork("faults");
    this.quota = new RepositoryScanQuota(config.quota);
    this.quotaLimits = {
      maxConcurrentPerRepository: 2,
      maxScansPerWindow: 20,
      windowMs: 60_000,
      ...config.quota,
    };
    this.leases = new ScanLeaseManager(config.leaseTtlMs, () => this.sched.now);
    this.slo = new QueueAgeSlo(config.queueAge);
    this.workers = Array.from({ length: config.workers }, (_, i) => ({
      id: `worker-${i}`,
      busy: false,
      deadUntil: 0,
      busySince: 0,
    }));
    for (const tenant of config.tenants) {
      this.queues.set(tenant.repositoryId, []);
      this.tenantByRepo.set(tenant.repositoryId, tenant);
      this.arrivalRng.set(tenant.repositoryId, this.rng.fork(`arrival:${tenant.repositoryId}`));
      this.waitByRepo.set(tenant.repositoryId, []);
      this.maxInFlightByRepo.set(tenant.repositoryId, 0);
    }
  }

  run(): LoadReport {
    for (const tenant of this.cfg.tenants) {
      this.scheduleFirstArrival(tenant);
      if (tenant.burst) this.scheduleBurst(tenant, tenant.burst);
    }
    this.sched.schedule(0, () => this.sample());
    this.sched.after(this.cfg.reaperIntervalMs, () => this.reap());

    const maxEvents = this.cfg.maxEvents ?? DEFAULT_MAX_EVENTS;
    const check = this.cfg.checkInvariants !== false;
    while (this.sched.pending > 0) {
      if (this.sched.processed >= maxEvents) {
        this.violate(`event cap of ${maxEvents} reached before the run drained`);
        break;
      }
      this.sched.step();
      if (check) this.checkInvariants();
    }
    this.checkFinalState();
    return this.buildReport();
  }

  // ---- arrivals -----------------------------------------------------------

  private scheduleFirstArrival(tenant: TenantProfile): void {
    if (tenant.ratePerSec <= 0) return;
    this.scheduleNextArrival(tenant, 0);
  }

  private scheduleNextArrival(tenant: TenantProfile, from: number): void {
    const gap = (this.arrivalRng.get(tenant.repositoryId) as Rng).exponential(1000 / tenant.ratePerSec);
    const at = from + Math.max(1, Math.round(gap));
    if (at > this.cfg.arrivalWindowMs) return;
    this.arrivalsPending += 1;
    this.sched.schedule(at, () => {
      this.arrivalsPending -= 1;
      this.submit(tenant, this.nextSha(tenant.repositoryId));
      this.scheduleNextArrival(tenant, at);
    });
  }

  private scheduleBurst(tenant: TenantProfile, burst: NonNullable<TenantProfile["burst"]>): void {
    const rng = this.arrivalRng.get(tenant.repositoryId) as Rng;
    for (let i = 0; i < burst.count; i += 1) {
      const at = burst.atMs + rng.int(0, Math.max(0, burst.spreadMs));
      this.arrivalsPending += 1;
      this.sched.schedule(at, () => {
        this.arrivalsPending -= 1;
        this.submit(tenant, this.nextSha(tenant.repositoryId));
      });
    }
  }

  private nextSha(repositoryId: string): string {
    const n = (this.shaCounter.get(repositoryId) ?? 0) + 1;
    this.shaCounter.set(repositoryId, n);
    return n.toString(16).padStart(40, "0");
  }

  private submit(tenant: TenantProfile, sha: string): void {
    const repo = tenant.repositoryId;
    const now = this.sched.now;
    this.submitted += 1;
    this.submittedByRepo.set(repo, (this.submittedByRepo.get(repo) ?? 0) + 1);

    const scanId = `scan-${++this.scanSeq}`;
    const outcome = this.dedup.register(repo, sha, scanId, now);
    if (outcome.status === "duplicate") {
      this.deduplicated += 1;
      return;
    }

    this.uniqueScans += 1;
    const service = this.cfg.service;
    const totalMs = this.serviceRng.int(service.minMs, service.maxMs);
    this.enqueue({
      scanId,
      repositoryId: repo,
      arrivedAt: now,
      queuedAt: now,
      seq: 0,
      attempts: 0,
      itemMs: Math.max(1, Math.floor(totalMs / service.items)),
      poison: tenant.poison === true,
    });

    // Clients re-send: the same revision arrives again shortly after.
    const faults = this.cfg.faults;
    if (faults.maxDuplicates > 0 && this.faultRng.chance(faults.duplicateRate)) {
      const copies = this.faultRng.int(1, faults.maxDuplicates);
      for (let i = 0; i < copies; i += 1) {
        this.arrivalsPending += 1;
        this.sched.after(Math.max(1, Math.round(this.faultRng.exponential(500))), () => {
          this.arrivalsPending -= 1;
          this.submit(tenant, sha);
        });
      }
    }
  }

  // ---- queue and dispatch ---------------------------------------------------

  private enqueue(job: Job): void {
    job.seq = ++this.seq;
    job.queuedAt = this.sched.now;
    (this.queues.get(job.repositoryId) as Job[]).push(job);
    this.queued += 1;
    this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queued);
    this.dispatch();
  }

  private idleWorker(): Worker | undefined {
    const now = this.sched.now;
    return this.workers.find((w) => !w.busy && now >= w.deadUntil);
  }

  private dispatch(): void {
    for (;;) {
      const worker = this.idleWorker();
      if (!worker) return;

      // Oldest waiting job first, across repositories (global FIFO).
      const heads: Job[] = [];
      for (const queue of this.queues.values()) {
        if (queue.length > 0) heads.push(queue[0]);
      }
      heads.sort((a, b) => a.seq - b.seq);

      let assigned = false;
      for (const job of heads) {
        const now = this.sched.now;
        const decision = this.quota.tryAcquire(job.repositoryId, now);
        if (!decision.allowed) {
          if (decision.reason === "repository_window_exceeded") {
            this.rejections.window += 1;
            this.scheduleWake(job.repositoryId, now + (decision.retryAfterMs ?? 1));
          } else {
            this.rejections.concurrency += 1;
          }
          continue;
        }
        this.recordAdmission(job.repositoryId, now);

        const lease = this.leases.acquire(job.scanId, worker.id);
        if (!lease.granted) {
          this.quota.release(job.repositoryId);
          this.violate(`lease for ${job.scanId} still held by ${lease.heldBy} when it was re-dispatched`);
          continue;
        }

        (this.queues.get(job.repositoryId) as Job[]).shift();
        this.queued -= 1;
        this.startAttempt(worker, job, lease.lease.token);
        assigned = true;
        break;
      }
      if (!assigned) return;
    }
  }

  private scheduleWake(repositoryId: string, at: number): void {
    const existing = this.wakeAt.get(repositoryId);
    if (existing !== undefined && existing >= this.sched.now && existing <= at) return;
    this.wakeAt.set(repositoryId, at);
    this.sched.schedule(at, () => {
      if (this.wakeAt.get(repositoryId) === at) this.wakeAt.delete(repositoryId);
      this.dispatch();
    });
  }

  private recordAdmission(repositoryId: string, now: number): void {
    let log = this.admissions.get(repositoryId);
    if (!log) {
      log = [];
      this.admissions.set(repositoryId, log);
    }
    log.push(now);
    const { maxScansPerWindow, windowMs } = this.quotaLimits;
    if (log.length > maxScansPerWindow) {
      const earlier = log[log.length - 1 - maxScansPerWindow];
      if (now - earlier < windowMs) {
        this.violate(`${repositoryId} admitted more than ${maxScansPerWindow} scans within ${windowMs}ms`);
      }
    }
  }

  // ---- attempts ---------------------------------------------------------------

  private startAttempt(worker: Worker, job: Job, token: number): void {
    const now = this.sched.now;
    worker.busy = true;
    worker.busySince = now;
    const items = this.cfg.service.items;

    if (job.firstStartedAt === undefined) {
      job.firstStartedAt = now;
      (this.waitByRepo.get(job.repositoryId) as number[]).push(now - job.arrivedAt);
    }

    const resume = this.checkpoints.resumeFrom(job.scanId);
    const nextItem = resume ? resume.nextIndex : 0;

    const attempt: Attempt = {
      id: ++this.attemptSeq,
      job,
      worker,
      token,
      nextItem,
      fault: "none",
      faultAtItem: -1,
      state: "running",
    };
    this.running.set(job.scanId, attempt);
    this.latestToken.set(job.scanId, token);
    const inFlight = this.countRunning(job.repositoryId);
    this.maxInFlightByRepo.set(job.repositoryId, Math.max(this.maxInFlightByRepo.get(job.repositoryId) ?? 0, inFlight));

    if (nextItem >= items) {
      // Interrupted after the final checkpoint: nothing left but to commit.
      this.complete(attempt);
      return;
    }

    this.chooseFault(attempt, items);
    this.sched.after(job.itemMs, () => this.onItemDone(attempt));
  }

  private chooseFault(attempt: Attempt, items: number): void {
    const lo = attempt.nextItem + 1;
    const hi = items - 1;
    if (hi < lo) return; // no room to fault mid-scan
    if (attempt.job.poison) {
      attempt.fault = "fail";
      attempt.faultAtItem = lo;
      return;
    }
    const f = this.cfg.faults;
    const u = this.faultRng.next();
    let kind: FaultKind = "none";
    if (u < f.crashRate) kind = "crash";
    else if (u < f.crashRate + f.stallRate) kind = "stall";
    else if (u < f.crashRate + f.stallRate + f.failRate) kind = "fail";
    if (kind === "none") return;
    attempt.fault = kind;
    attempt.faultAtItem = this.faultRng.int(lo, hi);
  }

  private onItemDone(attempt: Attempt): void {
    const { job, worker } = attempt;
    const scanId = job.scanId;
    const now = this.sched.now;

    // Heartbeat: a worker may only keep working while it holds the current lease.
    const renewed = this.leases.renew(scanId, worker.id, attempt.token);
    const isLatest = attempt.token === this.latestToken.get(scanId);
    if (renewed && !isLatest) {
      this.violate(`${scanId}: stale fencing token ${attempt.token} was allowed to renew`);
    }
    if (!renewed) {
      this.fenceOut(attempt);
      return;
    }

    attempt.nextItem += 1;
    this.executions.set(scanId, (this.executions.get(scanId) ?? 0) + 1);

    const items = this.cfg.service.items;
    const finished = attempt.nextItem >= items;
    const faultNow = !finished && attempt.faultAtItem === attempt.nextItem;

    if (faultNow && attempt.fault === "crash") {
      // Dies before saving progress; the lease is left to expire.
      attempt.state = "crashed";
      this.crashes += 1;
      this.releaseWorkerTime(worker, now);
      worker.busy = false;
      worker.deadUntil = now + this.cfg.faults.workerRestartMs;
      this.sched.schedule(worker.deadUntil, () => this.dispatch());
      return;
    }

    try {
      if (attempt.nextItem % this.cfg.service.checkpointEvery === 0 || finished) {
        this.checkpoints.save(scanId, "analyze", attempt.nextItem, items, now);
      }
    } catch (error) {
      this.violate(`${scanId}: checkpoint rejected valid progress (${(error as Error).message})`);
    }

    if (finished) {
      this.complete(attempt);
      return;
    }
    if (faultNow && attempt.fault === "stall") {
      attempt.state = "stalled";
      this.stalls += 1;
      this.sched.after(this.cfg.faults.stallMs, () => this.onStallWake(attempt));
      return;
    }
    if (faultNow && attempt.fault === "fail") {
      this.fail(attempt);
      return;
    }
    this.sched.after(job.itemMs, () => this.onItemDone(attempt));
  }

  private onStallWake(attempt: Attempt): void {
    const { job, worker } = attempt;
    const renewed = this.leases.renew(job.scanId, worker.id, attempt.token);
    if (renewed) {
      this.violate(`${job.scanId}: a worker stalled past its lease TTL kept its lease`);
    }
    this.fenceOut(attempt);
  }

  /** The lease manager refused this worker: abandon the scan without committing. */
  private fenceOut(attempt: Attempt): void {
    const { job, worker } = attempt;
    const live = this.leases.get(job.scanId);
    if (live && live.owner === worker.id && live.token === attempt.token) {
      this.violate(`${job.scanId}: lease manager refused the current, live holder`);
    }
    this.fencedOut += 1;
    this.releaseWorkerTime(worker, this.sched.now);
    worker.busy = false;
    // Leave `running` alone: if nobody reclaimed it yet, the reaper will.
    this.dispatch();
  }

  private complete(attempt: Attempt): void {
    const { job, worker } = attempt;
    const scanId = job.scanId;
    const now = this.sched.now;

    if (!this.leases.release(scanId, worker.id, attempt.token)) {
      this.violate(`${scanId}: completing worker could not release its own lease`);
    }
    this.quota.release(job.repositoryId);
    this.running.delete(scanId);

    const count = (this.completions.get(scanId) ?? 0) + 1;
    this.completions.set(scanId, count);
    if (count > 1) this.violate(`${scanId}: committed ${count} times`);
    if ((this.executions.get(scanId) ?? 0) < this.cfg.service.items) {
      this.violate(`${scanId}: completed with fewer than ${this.cfg.service.items} items executed`);
    }

    this.checkpoints.clear(scanId);
    this.completed += 1;
    this.completedByRepo.set(job.repositoryId, (this.completedByRepo.get(job.repositoryId) ?? 0) + 1);
    this.endToEnd.push(now - job.arrivedAt);
    this.lastCompletionAt = now;
    this.releaseWorkerTime(worker, now);
    worker.busy = false;
    this.dispatch();
  }

  private fail(attempt: Attempt): void {
    const { job, worker } = attempt;
    this.failures += 1;
    if (!this.leases.release(job.scanId, worker.id, attempt.token)) {
      this.violate(`${job.scanId}: failing worker could not release its own lease`);
    }
    this.quota.release(job.repositoryId);
    this.running.delete(job.scanId);
    this.releaseWorkerTime(worker, this.sched.now);
    worker.busy = false;

    job.attempts += 1;
    this.retryOrDeadLetter(job, true);
    this.dispatch();
  }

  private retryOrDeadLetter(job: Job, withBackoff: boolean): void {
    const retry = this.cfg.retry;
    if (job.attempts >= retry.maxAttempts) {
      this.deadLetters.push(job.scanId);
      this.deadLettersByRepo.set(job.repositoryId, (this.deadLettersByRepo.get(job.repositoryId) ?? 0) + 1);
      this.checkpoints.clear(job.scanId);
      return;
    }
    this.retries += 1;
    if (!withBackoff) {
      this.enqueue(job);
      return;
    }
    const delay = Math.round(retry.backoffMs * Math.pow(retry.multiplier, job.attempts - 1));
    this.retryPending += 1;
    this.sched.after(delay, () => {
      this.retryPending -= 1;
      this.enqueue(job);
    });
  }

  // ---- background tasks -----------------------------------------------------

  /** Reclaims scans whose worker died or froze: their lease has expired. */
  private reap(): void {
    for (const attempt of [...this.running.values()]) {
      const { job } = attempt;
      if (this.leases.get(job.scanId) !== undefined) continue;
      if (attempt.state === "running") {
        this.violate(`${job.scanId}: lease of a healthy worker expired`);
      }
      this.running.delete(job.scanId);
      this.quota.release(job.repositoryId);
      this.reaped += 1;
      job.attempts += 1;
      this.retryOrDeadLetter(job, false);
    }
    this.leases.reclaimExpired();
    // Freed quota slots may unblock work that was waiting on them.
    this.dispatch();
    if (!this.isDrained()) {
      this.sched.after(this.cfg.reaperIntervalMs, () => this.reap());
    }
  }

  private sample(): void {
    const now = this.sched.now;
    let oldest: number | undefined;
    for (const queue of this.queues.values()) {
      if (queue.length > 0 && (oldest === undefined || queue[0].queuedAt < oldest)) {
        oldest = queue[0].queuedAt;
      }
    }
    const age = oldest === undefined ? 0 : this.slo.evaluate(oldest, now);
    const status = typeof age === "number" ? "healthy" : age.status;
    const ageMs = typeof age === "number" ? 0 : age.ageMs;
    this.ageSamples.samples += 1;
    this.ageSamples[status] += 1;
    this.ageSamples.worstAgeMs = Math.max(this.ageSamples.worstAgeMs, ageMs);
    if (!this.isDrained()) {
      this.sched.after(this.cfg.sampleIntervalMs, () => this.sample());
    }
  }

  private isDrained(): boolean {
    return this.arrivalsPending === 0 && this.retryPending === 0 && this.queued === 0 && this.running.size === 0;
  }

  // ---- invariants -----------------------------------------------------------

  private countRunning(repositoryId: string): number {
    let n = 0;
    for (const attempt of this.running.values()) {
      if (attempt.job.repositoryId === repositoryId) n += 1;
    }
    return n;
  }

  private checkInvariants(): void {
    const now = this.sched.now;
    const max = this.quotaLimits.maxConcurrentPerRepository;
    for (const repo of this.queues.keys()) {
      const inFlight = this.quota.snapshot(repo, now).inFlight;
      const truth = this.countRunning(repo);
      if (inFlight !== truth) {
        this.violate(`${repo}: quota tracks ${inFlight} in flight but ${truth} scans are running`);
      }
      if (truth > max) {
        this.violate(`${repo}: ${truth} concurrent scans exceed the limit of ${max}`);
      }
    }
  }

  private checkFinalState(): void {
    if (!this.isDrained()) {
      this.violate("run ended with work still queued or running");
    }
    if (this.completed + this.deadLetters.length !== this.uniqueScans) {
      this.violate(
        `scans lost: ${this.uniqueScans} unique, ${this.completed} completed, ${this.deadLetters.length} dead-lettered`,
      );
    }
    if (this.submitted - this.deduplicated !== this.uniqueScans) {
      this.violate("deduplication accounting does not add up");
    }
    if (this.leases.activeCount() !== 0) {
      this.violate(`${this.leases.activeCount()} leases still live after the run drained`);
    }
    for (const repo of this.queues.keys()) {
      if (this.quota.snapshot(repo, this.sched.now).inFlight !== 0) {
        this.violate(`${repo}: quota slots leaked`);
      }
    }
    // Every revision executed to completion exactly once, replays aside.
    const replayBudget = (this.crashes + this.stalls + this.failures) * this.cfg.service.checkpointEvery;
    if (this.replayedItems() > replayBudget) {
      this.violate(`replayed ${this.replayedItems()} items, more than the ${replayBudget} the checkpoints allow`);
    }
  }

  private replayedItems(): number {
    let replayed = 0;
    for (const [scanId, count] of this.completions) {
      if (count > 0) replayed += (this.executions.get(scanId) ?? 0) - this.cfg.service.items;
    }
    return replayed;
  }

  private violate(message: string): void {
    this.violationCount += 1;
    if (this.violations.length < MAX_VIOLATIONS) {
      this.violations.push(`t=${this.sched.now}ms ${message}`);
    }
  }

  private releaseWorkerTime(worker: Worker, now: number): void {
    this.busyMsTotal += Math.max(0, now - worker.busySince);
  }

  // ---- report -------------------------------------------------------------------

  private buildReport(): LoadReport {
    const drainedAtMs = this.sched.now;
    const perTenant: Record<string, TenantReport> = {};
    const quietWaits: number[] = [];
    const allWaits: number[] = [];
    let maxInFlightPerRepository = 0;
    for (const tenant of this.cfg.tenants) {
      const repo = tenant.repositoryId;
      const waits = this.waitByRepo.get(repo) as number[];
      allWaits.push(...waits);
      if ((tenant.role ?? "normal") === "normal") quietWaits.push(...waits);
      const maxInFlight = this.maxInFlightByRepo.get(repo) ?? 0;
      maxInFlightPerRepository = Math.max(maxInFlightPerRepository, maxInFlight);
      perTenant[repo] = {
        submitted: this.submittedByRepo.get(repo) ?? 0,
        completed: this.completedByRepo.get(repo) ?? 0,
        deadLettered: this.deadLettersByRepo.get(repo) ?? 0,
        wait: summarize(waits),
        maxInFlight,
      };
    }
    const makespan = Math.max(1, drainedAtMs);
    const samples = this.ageSamples;
    return {
      scenario: this.cfg.name,
      seed: this.cfg.seed,
      drainedAtMs,
      events: this.sched.processed,
      submitted: this.submitted,
      deduplicated: this.deduplicated,
      uniqueScans: this.uniqueScans,
      completed: this.completed,
      deadLettered: this.deadLetters.length,
      retries: this.retries,
      crashes: this.crashes,
      stalls: this.stalls,
      fencedOut: this.fencedOut,
      reaped: this.reaped,
      quotaRejections: { ...this.rejections },
      replayedItems: this.replayedItems(),
      maxQueueDepth: this.maxQueueDepth,
      maxInFlightPerRepository,
      workerUtilization: Math.round((this.busyMsTotal / (makespan * this.cfg.workers)) * 1000) / 1000,
      throughputPerSec: Math.round((this.completed / (Math.max(1, this.lastCompletionAt) / 1000)) * 1000) / 1000,
      wait: summarize(allWaits),
      quietWait: summarize(quietWaits),
      endToEnd: summarize(this.endToEnd),
      queueAge: {
        samples: samples.samples,
        healthy: samples.healthy,
        warning: samples.warning,
        breached: samples.breached,
        worstAgeMs: samples.worstAgeMs,
        compliance: samples.samples === 0 ? 1 : Math.round((samples.healthy / samples.samples) * 1000) / 1000,
      },
      perTenant,
      violations:
        this.violationCount > this.violations.length
          ? [...this.violations, `... and ${this.violationCount - this.violations.length} more`]
          : [...this.violations],
    };
  }
}

export function runSimulation(config: SimulationConfig): LoadReport {
  return new ScanPipelineSimulation(config).run();
}
