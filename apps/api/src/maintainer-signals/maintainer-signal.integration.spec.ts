/**
 * Integration tests across the maintainer-signal boundaries: API-facing
 * service, job queue and leases, registry providers (over a fake HTTP layer
 * serving recorded registry responses), SBOM ingestion, and both stores.
 */

import { promises as fs, readFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { SbomIngestionService } from "../sbom/sbom-ingestion.service";
import { InMemorySbomStore } from "../sbom/sbom-store";
import type { RawPackageMaintainers } from "./maintainer-signal-analyzer";
import {
  CratesIoMaintainerProvider,
  MaintainerRegistryProvider,
  NpmMaintainerProvider,
  StaticMaintainerProvider,
} from "./maintainer-registry-provider";
import type { MaintainerSignalConfig } from "./maintainer-signal-config";
import type {
  MaintainerSignalLogFields,
  MaintainerSignalLogLevel,
  MaintainerSignalLogger,
} from "./maintainer-signal-metrics";
import {
  FileMaintainerSignalStore,
  InMemoryMaintainerSignalStore,
  MaintainerSignalStore,
} from "./maintainer-signal-store";
import {
  MaintainerSignalService,
  MaintainerSignalServiceOptions,
} from "./maintainer-signal.service";
import { MaintainerSignalWorker } from "./maintainer-signal-worker";
import type { PackageRef } from "./maintainer-signal-types";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const sbomFixture = (name: string) =>
  readFileSync(
    path.join(__dirname, "..", "sbom", "__fixtures__", name),
    "utf8",
  );

class CapturingLogger implements MaintainerSignalLogger {
  readonly entries: Array<{
    level: MaintainerSignalLogLevel;
    event: string;
    fields: MaintainerSignalLogFields;
  }> = [];
  log(
    level: MaintainerSignalLogLevel,
    event: string,
    fields: MaintainerSignalLogFields,
  ): void {
    this.entries.push({ level, event, fields });
  }
  events(): string[] {
    return this.entries.map((e) => e.event);
  }
}

/** Provider whose behaviour per package can be scripted. */
class ScriptedProvider implements MaintainerRegistryProvider {
  readonly calls: string[] = [];
  /** Remaining transient failures per package name. */
  readonly failures = new Map<string, number>();
  readonly hang = new Set<string>();
  onCall?: (ref: PackageRef) => void;
  constructor(
    readonly ecosystem: string,
    readonly data: Map<string, RawPackageMaintainers> = new Map(),
  ) {}

  async fetchMaintainers(
    ref: PackageRef,
    signal: AbortSignal,
  ): Promise<RawPackageMaintainers | undefined> {
    this.calls.push(ref.name);
    this.onCall?.(ref);
    if (this.hang.has(ref.name)) {
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }
    const remaining = this.failures.get(ref.name) ?? 0;
    if (remaining > 0) {
      this.failures.set(ref.name, remaining - 1);
      throw new Error("ECONNRESET");
    }
    const value = this.data.get(ref.name);
    return value && JSON.parse(JSON.stringify(value));
  }
}

const owners = (...handles: string[]): RawPackageMaintainers => ({
  maintainers: handles.map((handle) => ({
    handle,
    email: `${handle}@example.com`,
  })),
});

const pkgs = (...names: string[]): PackageRef[] =>
  names.map((name) => ({ ecosystem: "npm", name }));

interface Harness {
  service: MaintainerSignalService;
  store: MaintainerSignalStore;
  logger: CapturingLogger;
  npm: ScriptedProvider;
  clock: { now: number };
}

function harness(
  config: Partial<MaintainerSignalConfig> = {},
  extra: Partial<MaintainerSignalServiceOptions> = {},
): Harness {
  const clock = { now: 1_700_000_000_000 };
  const store = extra.store ?? new InMemoryMaintainerSignalStore();
  const logger = new CapturingLogger();
  const npm = new ScriptedProvider("npm");
  const service = new MaintainerSignalService({
    store,
    providers: [npm],
    logger,
    clock: () => clock.now,
    sleep: async () => undefined,
    ...extra,
    config: { retryBackoffMs: 0, lookupRetryBackoffMs: 0, ...config },
  });
  return { service, store, logger, npm, clock };
}

async function scan(
  h: Harness,
  scanId: string,
  packages: PackageRef[],
  tenantId = "tenant-a",
) {
  await h.service.submit({
    tenantId,
    repositoryId: "repo-1",
    scanId,
    packages,
  });
  const outcomes = await h.service.drain("worker-1");
  return {
    outcomes,
    report: await h.service.getReport(tenantId, "repo-1", scanId),
  };
}

describe("MaintainerSignalService: change detection over successive scans", () => {
  it("baselines first, reports changes once, then stays quiet", async () => {
    const h = harness();
    h.npm.data.set("left-pad", owners("alice", "bob"));
    h.npm.data.set("stable", owners("carol"));

    const first = await scan(h, "scan-1", pkgs("left-pad", "stable"));
    expect(first.outcomes).toEqual([
      expect.objectContaining({
        status: "completed",
        reportStatus: "complete",
        signals: 0,
      }),
    ]);
    expect(first.report?.stats).toEqual({
      packages: 2,
      compared: 0,
      baselined: 2,
      changed: 0,
      skipped: 0,
      lookupFailures: 0,
    });

    h.clock.now += 86_400_000;
    h.npm.data.set("left-pad", owners("mallory"));
    const second = await scan(h, "scan-2", pkgs("left-pad", "stable"));
    expect(second.report?.signals).toEqual([
      {
        type: "OWNERSHIP_TRANSFERRED",
        severity: "high",
        ecosystem: "npm",
        package: "left-pad",
        handles: ["mallory"],
        baselineObservedAt: 1_700_000_000_000,
      },
    ]);
    expect(second.report?.stats).toMatchObject({
      compared: 2,
      changed: 1,
      baselined: 0,
    });

    const third = await scan(h, "scan-3", pkgs("left-pad", "stable"));
    expect(third.report?.signals).toEqual([]);
    expect(third.report?.stats.changed).toBe(0);
  });

  it("applies minSeverity", async () => {
    const h = harness({ minSeverity: "medium" });
    h.npm.data.set("a", owners("x"));
    await scan(h, "s1", pkgs("a"));
    h.npm.data.set("a", owners("x", "y"));
    const { report } = await scan(h, "s2", pkgs("a"));
    // MAINTAINER_ADDED is low severity; the change still counts in stats.
    expect(report?.signals).toEqual([]);
    expect(report?.stats.changed).toBe(1);
  });

  it("skips unsupported ecosystems and unknown packages without failing", async () => {
    const h = harness();
    h.npm.data.set("known", owners("a"));
    const { outcomes, report } = await scan(h, "s1", [
      { ecosystem: "pypi", name: "requests" },
      { ecosystem: "npm", name: "known" },
      { ecosystem: "npm", name: "private-pkg" },
      { ecosystem: "cargo", name: "serde" }, // no provider registered
    ]);
    expect(outcomes[0]).toMatchObject({
      status: "completed",
      reportStatus: "complete",
    });
    expect(report?.skipped).toEqual([
      { ecosystem: "cargo", package: "serde", reason: "UNSUPPORTED_ECOSYSTEM" },
      { ecosystem: "npm", package: "private-pkg", reason: "NOT_FOUND" },
      {
        ecosystem: "pypi",
        package: "requests",
        reason: "UNSUPPORTED_ECOSYSTEM",
      },
    ]);
    expect(h.npm.calls.sort()).toEqual(["known", "private-pkg"]);
  });

  it("skips malformed registry data as INVALID_METADATA", async () => {
    const h = harness({ maxMaintainersPerPackage: 2 });
    h.npm.data.set("crowded", owners("a", "b", "c"));
    h.npm.data.set("broken", {
      maintainers: "nope",
    } as unknown as RawPackageMaintainers);
    const { report } = await scan(h, "s1", pkgs("crowded", "broken"));
    expect(report?.skipped.map((s) => s.reason)).toEqual([
      "INVALID_METADATA",
      "INVALID_METADATA",
    ]);
    // Invalid data is not transient, so it is not retried.
    expect(h.npm.calls).toHaveLength(2);
  });

  it("caps reported skip details but keeps exact counts", async () => {
    const h = harness({ maxReportedSkips: 1 });
    const { report } = await scan(h, "s1", pkgs("x", "y", "z"));
    expect(report?.skipped).toHaveLength(1);
    expect(report?.stats.skipped).toBe(3);
  });
});

describe("MaintainerSignalService: retries and partial failure", () => {
  it("retries transient lookup failures per package", async () => {
    const h = harness({ lookupMaxAttempts: 3 });
    h.npm.data.set("flaky", owners("a"));
    h.npm.failures.set("flaky", 2);
    const { report } = await scan(h, "s1", pkgs("flaky"));
    expect(report?.status).toBe("complete");
    expect(h.npm.calls).toEqual(["flaky", "flaky", "flaky"]);
    expect(h.service.metrics.snapshot().lookupRetries).toBe(2);
  });

  it("times out hung lookups", async () => {
    const h = harness({
      lookupTimeoutMs: 20,
      lookupMaxAttempts: 1,
      maxFailedLookupRatio: 1,
    });
    h.npm.hang.add("slow");
    const { report } = await scan(h, "s1", pkgs("slow"));
    expect(report?.skipped).toEqual([
      { ecosystem: "npm", package: "slow", reason: "LOOKUP_FAILED" },
    ]);
  });

  it("produces a partial report within the failure ratio and keeps old baselines", async () => {
    const h = harness({ lookupMaxAttempts: 1, maxFailedLookupRatio: 0.25 });
    const names = ["a", "b", "c", "d"];
    for (const n of names) h.npm.data.set(n, owners("owner"));
    await scan(h, "s1", pkgs(...names));

    // "d" changes hands while its registry lookups fail.
    h.npm.data.set("d", owners("mallory"));
    h.npm.failures.set("d", 1);
    const partial = await scan(h, "s2", pkgs(...names));
    expect(partial.report?.status).toBe("partial");
    expect(partial.report?.stats.lookupFailures).toBe(1);
    expect(partial.report?.signals).toEqual([]);

    // The baseline for "d" was not advanced, so the change surfaces next time.
    const recovered = await scan(h, "s3", pkgs(...names));
    expect(recovered.report?.status).toBe("complete");
    expect(recovered.report?.signals.map((s) => [s.type, s.package])).toEqual([
      ["OWNERSHIP_TRANSFERRED", "d"],
    ]);
  });

  it("fails the job above the ratio, persists nothing, and dead-letters", async () => {
    const h = harness({
      lookupMaxAttempts: 1,
      maxFailedLookupRatio: 0.25,
      maxAttempts: 2,
    });
    h.npm.data.set("a", owners("x"));
    h.npm.data.set("b", owners("x"));
    h.npm.failures.set("a", 10);

    await h.service.submit({
      tenantId: "t",
      repositoryId: "repo-1",
      scanId: "s1",
      packages: pkgs("a", "b"),
    });
    const outcomes = await h.service.drain("w");
    expect(outcomes.map((o) => o.status)).toEqual([
      "retry_scheduled",
      "dead_lettered",
    ]);
    expect(outcomes[1]).toMatchObject({ code: "LOOKUP_FAILURE_THRESHOLD" });
    await expect(
      h.service.getReport("t", "repo-1", "s1"),
    ).resolves.toBeUndefined();
    await expect(
      h.store.getBaselines("t", "repo-1", [{ ecosystem: "npm", package: "b" }]),
    ).resolves.toEqual([]);
    expect(h.logger.entries.at(-1)).toMatchObject({
      level: "error",
      event: "maintainer_signals.analysis_failed",
      fields: { code: "LOOKUP_FAILURE_THRESHOLD", outcome: "dead_lettered" },
    });
  });

  it("does not lose signals when the baseline write fails", async () => {
    const inner = new InMemoryMaintainerSignalStore();
    let failBaselineWrites = 0;
    const store: MaintainerSignalStore = {
      getBaselines: (...a) => inner.getBaselines(...a),
      getReport: (...a) => inner.getReport(...a),
      putReport: (r) => inner.putReport(r),
      putBaselines: async (...a) => {
        if (failBaselineWrites-- > 0) {
          throw new Error("EIO /var/lib/gasguard token=abc123");
        }
        return inner.putBaselines(...a);
      },
    };
    const h = harness({}, { store });
    h.npm.data.set("a", owners("x"));
    await scan(h, "s1", pkgs("a"));

    h.npm.data.set("a", owners("x", "y"));
    failBaselineWrites = 1;
    const { outcomes, report } = await scan(h, "s2", pkgs("a"));
    expect(outcomes.map((o) => o.status)).toEqual([
      "retry_scheduled",
      "completed",
    ]);
    expect(report?.signals.map((s) => s.type)).toEqual(["MAINTAINER_ADDED"]);
    expect(JSON.stringify(h.logger.entries)).not.toMatch(/abc123|var\/lib/);
  });
});

describe("MaintainerSignalService: SBOM boundary", () => {
  function recordedRegistry(lodashBody = fixture("npm-lodash-4.17.21.json")) {
    const routes: Record<string, string> = {
      "https://registry.npmjs.org/lodash/4.17.21": lodashBody,
      "https://registry.npmjs.org/@openzeppelin%2Fcontracts/5.0.2": fixture(
        "npm-openzeppelin-contracts-5.0.2.json",
      ),
      "https://crates.io/api/v1/crates/soroban-sdk/owners": fixture(
        "crates-soroban-sdk-owners.json",
      ),
      "https://crates.io/api/v1/crates/soroban-sdk/21.0.0": fixture(
        "crates-soroban-sdk-21.0.0.json",
      ),
    };
    const fetchImpl = async (url: string) => ({
      status: routes[url] ? 200 : 404,
      headers: { get: () => null },
      text: async () => routes[url] ?? "{}",
    });
    return [
      new NpmMaintainerProvider({ fetchImpl }),
      new CratesIoMaintainerProvider({ fetchImpl }),
    ];
  }

  async function ingest(sbom: SbomIngestionService, scanId: string) {
    await sbom.submit({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      scanId,
      document: sbomFixture("cyclonedx-1.5.json"),
    });
    await sbom.drain("sbom-worker");
  }

  it("analyzes a representative repository from its ingested SBOM", async () => {
    const sbom = new SbomIngestionService({
      store: new InMemorySbomStore(),
      config: { maxRejectedRatio: 0.5 },
      logger: { log: () => undefined },
    });
    const sbomSource = async (t: string, r: string, s: string) =>
      (await sbom.getResult(t, r, s))?.sbom;
    const store = new InMemoryMaintainerSignalStore();

    let h = harness({}, { store, sbomSource, providers: recordedRegistry() });
    // Submitted before the SBOM exists: retried until it has been ingested.
    await h.service.submit({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      scanId: "scan-1",
      fromSbom: true,
    });
    expect(await h.service.drain("w", 1)).toEqual([
      expect.objectContaining({
        status: "retry_scheduled",
        code: "SBOM_NOT_FOUND",
      }),
    ]);
    await ingest(sbom, "scan-1");
    expect((await h.service.drain("w"))[0]).toMatchObject({
      status: "completed",
    });
    const first = await h.service.getReport("tenant-a", "repo-1", "scan-1");
    expect(first?.stats).toMatchObject({
      packages: 3,
      baselined: 3,
      skipped: 0,
    });

    // Next scan: lodash gains a maintainer who also published the version,
    // and an existing maintainer's email domain moved.
    const lodash = JSON.parse(fixture("npm-lodash-4.17.21.json"));
    lodash.maintainers.push({
      name: "newcomer",
      email: "n@fresh-domain.example",
    });
    lodash.maintainers[1].email = "john.david.dalton@expired-domain.example";
    lodash._npmUser = { name: "newcomer", email: "n@fresh-domain.example" };
    h = harness(
      {},
      {
        store,
        sbomSource,
        providers: recordedRegistry(JSON.stringify(lodash)),
      },
    );
    await ingest(sbom, "scan-2");
    await h.service.submit({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      scanId: "scan-2",
      fromSbom: true,
    });
    await h.service.drain("w");
    const second = await h.service.getReport("tenant-a", "repo-1", "scan-2");
    expect(second?.signals.map((s) => [s.type, s.package, s.handles])).toEqual([
      ["MAINTAINER_EMAIL_DOMAIN_CHANGED", "lodash", ["jdalton"]],
      ["PUBLISHED_BY_NEW_MAINTAINER", "lodash", ["newcomer"]],
      ["MAINTAINER_ADDED", "lodash", ["newcomer"]],
    ]);
    // Emails and domains never reach the report.
    expect(JSON.stringify(second)).not.toMatch(/@|example|domain\.example/);
  });

  it("dead-letters when the SBOM has too many packages", async () => {
    const sbom = new SbomIngestionService({
      store: new InMemorySbomStore(),
      config: { maxRejectedRatio: 0.5 },
      logger: { log: () => undefined },
    });
    await ingest(sbom, "scan-1");
    const h = harness(
      { maxPackagesPerScan: 2 },
      { sbomSource: async (t, r, s) => (await sbom.getResult(t, r, s))?.sbom },
    );
    await h.service.submit({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      scanId: "scan-1",
      fromSbom: true,
    });
    expect((await h.service.drain("w"))[0]).toMatchObject({
      status: "dead_lettered",
      code: "TOO_MANY_PACKAGES",
    });
  });
});

describe("MaintainerSignalService: submission contract", () => {
  const base = { tenantId: "t", repositoryId: "r", scanId: "s" };

  it.each([
    [
      "invalid tenant",
      { ...base, tenantId: "../x", packages: [] },
      "INVALID_REQUEST",
    ],
    ["neither input", { ...base }, "INVALID_REQUEST"],
    [
      "both inputs",
      { ...base, packages: [], fromSbom: true },
      "INVALID_REQUEST",
    ],
    ["fromSbom without source", { ...base, fromSbom: true }, "INVALID_REQUEST"],
    [
      "bad package",
      { ...base, packages: [{ ecosystem: "npm" }] },
      "INVALID_REQUEST",
    ],
  ])("rejects %s", async (_label, request, code) => {
    const h = harness();
    await expect(h.service.submit(request as never)).rejects.toMatchObject({
      code,
    });
    expect(h.service.metrics.snapshot().submissionRejections[code]).toBe(1);
  });

  it("enforces maxPackagesPerScan at the boundary", async () => {
    const h = harness({ maxPackagesPerScan: 2 });
    await expect(
      h.service.submit({ ...base, packages: pkgs("a", "b") }),
    ).resolves.toMatchObject({ status: "accepted" });
    await expect(
      h.service.submit({
        ...base,
        scanId: "s2",
        packages: pkgs("a", "b", "c"),
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_PACKAGES", retryable: false });
  });

  it("refuses work when disabled", async () => {
    const h = harness({ enabled: false });
    await expect(
      h.service.submit({ ...base, packages: [] }),
    ).rejects.toMatchObject({
      code: "SIGNALS_DISABLED",
    });
  });

  it("de-duplicates identical submissions and rejects conflicting ones", async () => {
    const h = harness();
    const first = await h.service.submit({ ...base, packages: pkgs("a", "b") });
    // Same set in another order is the same input.
    await expect(
      h.service.submit({ ...base, packages: pkgs("b", "a") }),
    ).resolves.toEqual({
      ...first,
      status: "duplicate",
    });
    await expect(
      h.service.submit({ ...base, packages: pkgs("c") }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await h.service.drain("w");
    // After completion a different package set for the scan is accepted.
    await expect(
      h.service.submit({ ...base, packages: pkgs("c") }),
    ).resolves.toMatchObject({
      status: "accepted",
    });
  });

  it("sheds load per tenant with a retryable QUEUE_FULL", async () => {
    const h = harness({ maxPendingJobs: 3, maxPendingJobsPerTenant: 1 });
    await h.service.submit({ ...base, packages: [] });
    await expect(
      h.service.submit({ ...base, scanId: "s2", packages: [] }),
    ).rejects.toMatchObject({ code: "QUEUE_FULL", retryable: true });
    await expect(
      h.service.submit({ ...base, tenantId: "other", packages: [] }),
    ).resolves.toMatchObject({ status: "accepted" });
  });

  it("handles an empty package list", async () => {
    const h = harness();
    const { report } = await scan(h, "empty", []);
    expect(report).toMatchObject({
      status: "complete",
      signals: [],
      skipped: [],
    });
  });
});

describe("MaintainerSignalService: tenant isolation", () => {
  it("keeps baselines, jobs, and reports per tenant", async () => {
    const h = harness();
    h.npm.data.set("shared", owners("alice"));
    await scan(h, "s1", pkgs("shared"), "tenant-a");

    h.npm.data.set("shared", owners("mallory"));
    // Tenant B has never seen the package: first observation, no signal,
    // even though tenant A's baseline differs.
    const b = await scan(h, "s1", pkgs("shared"), "tenant-b");
    expect(b.report?.signals).toEqual([]);
    expect(b.report?.stats.baselined).toBe(1);

    const a = await scan(h, "s2", pkgs("shared"), "tenant-a");
    expect(a.report?.signals.map((s) => s.type)).toEqual([
      "OWNERSHIP_TRANSFERRED",
    ]);

    const job = await h.service.submit({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      scanId: "s3",
      packages: [],
    });
    expect(h.service.getJob("tenant-b", job.jobId)).toBeUndefined();
    expect(h.service.getJob("tenant-a", job.jobId)).toBeDefined();
    await expect(
      h.service.getReport("tenant-b", "repo-1", "s2"),
    ).resolves.toBeUndefined();
  });
});

describe("MaintainerSignalService: leases and workers", () => {
  it("abandons a job whose lease expired mid-analysis", async () => {
    const h = harness({ leaseTtlMs: 1_000 });
    h.npm.data.set("a", owners("x"));
    h.npm.onCall = () => {
      h.clock.now += 5_000;
    };
    await h.service.submit({
      tenantId: "t",
      repositoryId: "repo-1",
      scanId: "s",
      packages: pkgs("a"),
    });
    expect(await h.service.processNext("slow-worker")).toMatchObject({
      status: "stale",
    });
    await expect(
      h.service.getReport("t", "repo-1", "s"),
    ).resolves.toBeUndefined();

    h.npm.onCall = undefined;
    const outcomes = await h.service.drain("healthy-worker");
    expect(outcomes).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    const metrics = h.service.metrics.snapshot();
    expect(metrics.staleCompletions).toBe(1);
    expect(metrics.leasesRecovered).toBe(1);
  });

  it("runs jobs through the polling worker and stops cleanly", async () => {
    const h = harness();
    h.npm.data.set("a", owners("x"));
    const worker = new MaintainerSignalWorker(h.service, {
      workerId: "w",
      idleDelayMs: 5,
    });
    worker.start();
    await h.service.submit({
      tenantId: "t",
      repositoryId: "repo-1",
      scanId: "s",
      packages: pkgs("a"),
    });
    for (
      let i = 0;
      i < 100 && !(await h.service.getReport("t", "repo-1", "s"));
      i++
    ) {
      await new Promise((r) => setTimeout(r, 5));
    }
    await worker.stop();
    expect(worker.isRunning()).toBe(false);
    await expect(
      h.service.getReport("t", "repo-1", "s"),
    ).resolves.toBeDefined();
  });

  it("validates worker options", () => {
    const h = harness();
    expect(
      () => new MaintainerSignalWorker(h.service, { workerId: " " }),
    ).toThrow(TypeError);
    expect(
      () =>
        new MaintainerSignalWorker(h.service, {
          workerId: "w",
          idleDelayMs: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe("MaintainerSignalService: durable store", () => {
  it("keeps baselines across service restarts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gasguard-msig-int-"));
    try {
      const provider = new StaticMaintainerProvider("npm", {
        a: owners("alice"),
      });
      const make = () =>
        harness(
          {},
          { store: new FileMaintainerSignalStore(dir), providers: [provider] },
        );

      await scan(make(), "s1", pkgs("a"));
      provider.set("a", owners("mallory"));
      const { report } = await scan(make(), "s2", pkgs("a"));
      expect(report?.signals.map((s) => s.type)).toEqual([
        "OWNERSHIP_TRANSFERRED",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("MaintainerSignalService: observability", () => {
  it("logs and exports metrics without identities, emails, or package names", async () => {
    const h = harness();
    h.npm.data.set("secret-internal-pkg", owners("alice"));
    await scan(h, "s1", pkgs("secret-internal-pkg"));
    h.npm.data.set("secret-internal-pkg", owners("mallory"));
    await scan(h, "s2", pkgs("secret-internal-pkg"));

    const logs = JSON.stringify(h.logger.entries);
    const metrics = h.service.metricsText();
    for (const text of [logs, metrics]) {
      expect(text).not.toMatch(
        /alice|mallory|example\.com|secret-internal-pkg/,
      );
    }
    expect(h.logger.events()).toEqual([
      "maintainer_signals.submitted",
      "maintainer_signals.analyzed",
      "maintainer_signals.submitted",
      "maintainer_signals.analyzed",
    ]);
    expect(h.logger.entries[3].fields).toMatchObject({
      signalCount: 1,
      highSeveritySignals: 1,
      reportStatus: "complete",
    });
    expect(metrics).toContain(
      'gasguard_maintainer_signals_total{type="OWNERSHIP_TRANSFERRED"} 1',
    );
    expect(metrics).toContain(
      'gasguard_maintainer_registry_lookups_total{ecosystem="npm",outcome="found"} 2',
    );
    expect(metrics).toContain(
      'gasguard_maintainer_signal_queue_jobs{status="completed"} 2',
    );
  });

  it("strips identity-bearing keys even from custom log calls", async () => {
    const { sanitizeMaintainerLogFields } =
      await import("./maintainer-signal-metrics");
    expect(
      sanitizeMaintainerLogFields({
        jobId: "j",
        maintainerEmail: "a@b.c",
        publisher: "mallory",
        handles: "x",
        maintainerCount: 3,
        authToken: "t",
      }),
    ).toEqual({ jobId: "j", maintainerCount: 3 });
  });
});
