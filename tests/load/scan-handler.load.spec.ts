/**
 * Integration load: many tenants submit scans to the real command-injection
 * job handler at once, against one shared findings store.
 */
import * as fs from "fs";
import * as path from "path";
import { FindingsRepository } from "../../apps/api/src/findings/findings.repository";
import { FindingsService } from "../../apps/api/src/findings/findings.service";
import {
  CommandInjectionScanJobHandler,
  CommandInjectionScanJobPayload,
} from "../../apps/api/src/scanner/command-injection-scan.job";

const FIXTURE = path.resolve(__dirname, "../fixtures/command-injection/vulnerable-app");

function repoFiles(): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push({ path: path.relative(FIXTURE, full).split(path.sep).join("/"), content: fs.readFileSync(full, "utf8") });
    }
  };
  walk(FIXTURE);
  return out;
}

const silent = { info: () => undefined, warn: () => undefined };
const files = repoFiles();

const job = (org: string, repo: string, id: string): CommandInjectionScanJobPayload => ({
  organizationId: org,
  repositoryId: repo,
  analysisJobId: id,
  files,
});

function setup() {
  const findings = new FindingsService(new FindingsRepository());
  return { findings, handler: new CommandInjectionScanJobHandler({ findings, logger: silent }) };
}

jest.setTimeout(60_000);

describe("scan job handler under concurrent multi-tenant load", () => {
  const ORGS = 10;
  const REPOS = 3;

  it("persists each tenant's findings exactly once and never leaks across tenants", async () => {
    const baseline = await setup().handler.handle(job("baseline", "repo", "job"));
    expect(baseline.findingsPersisted).toBeGreaterThan(0);

    const { handler, findings } = setup();
    const jobs: CommandInjectionScanJobPayload[] = [];
    for (let o = 0; o < ORGS; o += 1) {
      for (let r = 0; r < REPOS; r += 1) jobs.push(job(`org-${o}`, `repo-${r}`, `job-${o}-${r}`));
    }
    const outcomes = await Promise.all(jobs.map((j) => handler.handle(j)));

    expect(outcomes.every((o) => o.status === "completed")).toBe(true);
    expect(outcomes.every((o) => o.findingsPersisted === baseline.findingsPersisted)).toBe(true);

    for (let o = 0; o < ORGS; o += 1) {
      for (let r = 0; r < REPOS; r += 1) {
        const page = findings.list({ organizationId: `org-${o}`, repositoryId: `repo-${r}`, limit: 100 });
        expect(page.items).toHaveLength(baseline.findingsPersisted);
        expect(page.items.every((f) => f.organizationId === `org-${o}` && f.repositoryId === `repo-${r}`)).toBe(true);
      }
    }
  });

  it("stays idempotent when the same scan is delivered many times at once", async () => {
    const { handler, findings } = setup();
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => handler.handle(job("org-a", "repo-1", "job-1"))));

    const persisted = outcomes.reduce((sum, o) => sum + o.findingsPersisted, 0);
    const page = findings.list({ organizationId: "org-a", repositoryId: "repo-1", limit: 100 });
    expect(persisted).toBe(page.items.length);
    expect(outcomes.filter((o) => o.findingsPersisted > 0)).toHaveLength(1);
  });

  it("isolates invalid jobs: they are rejected without affecting valid ones", async () => {
    const { handler, findings } = setup();
    const settled = await Promise.allSettled([
      handler.handle(job("org-a", "repo-1", "ok-1")),
      handler.handle(job("", "repo-1", "bad-org")),
      handler.handle(job("org-b", "repo-1", "ok-2")),
      handler.handle({ ...job("org-c", "repo-1", "bad-timeout"), timeoutMs: -1 }),
    ]);

    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "rejected", "fulfilled", "rejected"]);
    for (const s of settled) {
      if (s.status === "rejected") expect(s.reason).toEqual(expect.objectContaining({ code: "INVALID_JOB", retryable: false }));
    }
    expect(findings.list({ organizationId: "org-a", limit: 100 }).items.length).toBeGreaterThan(0);
    expect(findings.list({ organizationId: "org-b", limit: 100 }).items.length).toBeGreaterThan(0);
    expect(findings.list({ organizationId: "org-c", limit: 100 }).items).toHaveLength(0);
  });
});
