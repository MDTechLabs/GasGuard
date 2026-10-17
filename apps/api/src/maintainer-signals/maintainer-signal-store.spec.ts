import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import type { MaintainerBaseline } from "./maintainer-signal-analyzer";
import {
  FileMaintainerSignalStore,
  InMemoryMaintainerSignalStore,
  MaintainerSignalStore,
} from "./maintainer-signal-store";
import {
  MaintainerSignalError,
  MaintainerSignalReport,
} from "./maintainer-signal-types";

const baseline = (
  pkg: string,
  revision: number,
  handles: string[] = ["a"],
): MaintainerBaseline => ({
  ecosystem: "npm",
  package: pkg,
  maintainers: handles.map((handle) => ({ handle })),
  observedAt: revision * 1000,
  revision,
});

const report = (
  tenantId: string,
  scanId: string,
  revision: number,
): MaintainerSignalReport => ({
  schemaVersion: 1,
  tenantId,
  repositoryId: "repo",
  scanId,
  jobId: `job-${revision}`,
  revision,
  analyzedAt: revision,
  status: "complete",
  signals: [],
  skipped: [],
  stats: {
    packages: 0,
    compared: 0,
    baselined: 0,
    changed: 0,
    skipped: 0,
    lookupFailures: 0,
  },
});

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    tempDirs.map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

const factories: Array<[string, () => Promise<MaintainerSignalStore>]> = [
  [
    "InMemoryMaintainerSignalStore",
    async () => new InMemoryMaintainerSignalStore(),
  ],
  [
    "FileMaintainerSignalStore",
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gasguard-msig-"));
      tempDirs.push(dir);
      return new FileMaintainerSignalStore(dir);
    },
  ],
];

describe.each(factories)("%s", (_name, create) => {
  let store: MaintainerSignalStore;
  beforeEach(async () => {
    store = await create();
  });

  it("round-trips baselines and returns only existing keys", async () => {
    await expect(
      store.putBaselines("t1", "repo", [baseline("a", 1), baseline("b", 1)]),
    ).resolves.toBe(2);
    const found = await store.getBaselines("t1", "repo", [
      { ecosystem: "npm", package: "a" },
      { ecosystem: "npm", package: "missing" },
    ]);
    expect(found).toEqual([baseline("a", 1)]);
  });

  it("returns nothing for a repository with no baselines", async () => {
    await expect(
      store.getBaselines("t1", "none", [{ ecosystem: "npm", package: "a" }]),
    ).resolves.toEqual([]);
  });

  it("isolates tenants and repositories", async () => {
    await store.putBaselines("t1", "repo", [baseline("a", 1, ["t1-owner"])]);
    await store.putBaselines("t2", "repo", [baseline("a", 1, ["t2-owner"])]);
    const key = [{ ecosystem: "npm", package: "a" }];
    expect(
      (await store.getBaselines("t1", "repo", key))[0].maintainers,
    ).toEqual([{ handle: "t1-owner" }]);
    expect(
      (await store.getBaselines("t2", "repo", key))[0].maintainers,
    ).toEqual([{ handle: "t2-owner" }]);
    expect(await store.getBaselines("t1", "other", key)).toEqual([]);

    await store.putReport(report("t1", "scan", 1));
    await expect(
      store.getReport("t2", "repo", "scan"),
    ).resolves.toBeUndefined();
  });

  it("never rolls a baseline back to an older revision", async () => {
    await store.putBaselines("t1", "repo", [baseline("a", 5, ["new"])]);
    await expect(
      store.putBaselines("t1", "repo", [
        baseline("a", 4, ["old"]),
        baseline("b", 4),
      ]),
    ).resolves.toBe(1);
    const [a] = await store.getBaselines("t1", "repo", [
      { ecosystem: "npm", package: "a" },
    ]);
    expect(a.maintainers).toEqual([{ handle: "new" }]);
    // Equal revision (a retried job) is accepted.
    await expect(
      store.putBaselines("t1", "repo", [baseline("a", 5, ["retry"])]),
    ).resolves.toBe(1);
  });

  it("writes reports conditionally on revision", async () => {
    await expect(store.putReport(report("t1", "scan", 2))).resolves.toBe(
      "written",
    );
    await expect(store.putReport(report("t1", "scan", 1))).resolves.toBe(
      "stale",
    );
    await expect(store.putReport(report("t1", "scan", 2))).resolves.toBe(
      "written",
    );
    expect((await store.getReport("t1", "repo", "scan"))?.revision).toBe(2);
  });

  it("does not let callers mutate stored state", async () => {
    const b = baseline("a", 1);
    await store.putBaselines("t1", "repo", [b]);
    b.maintainers.push({ handle: "sneaky" });
    const [stored] = await store.getBaselines("t1", "repo", [
      { ecosystem: "npm", package: "a" },
    ]);
    expect(stored.maintainers).toEqual([{ handle: "a" }]);
  });
});

describe("FileMaintainerSignalStore", () => {
  async function fileStore() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gasguard-msig-"));
    tempDirs.push(dir);
    return { dir, store: new FileMaintainerSignalStore(dir) };
  }

  /** Files under `root`, as paths relative to it. */
  async function listFiles(root: string, dir = root): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await listFiles(root, full)));
      else out.push(path.relative(root, full));
    }
    return out;
  }

  it("rejects an empty root", () => {
    expect(() => new FileMaintainerSignalStore(" ")).toThrow(TypeError);
  });

  it("keeps crafted ids inside the root and out of file names", async () => {
    const { dir, store } = await fileStore();
    await store.putBaselines("../../etc", "../passwd", [baseline("a", 1)]);
    await store.putReport({
      ...report("../../etc", "../x", 1),
      repositoryId: "../passwd",
    });
    const files = await listFiles(dir);
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).not.toMatch(/etc|passwd|\.\./);
      expect(file).toMatch(
        /^[0-9a-f]{64}\/(baselines|reports)\/[0-9a-f]{64}\.json$/,
      );
    }
  });

  it("surfaces corrupt files as STORAGE_FAILURE", async () => {
    const { dir, store } = await fileStore();
    await store.putBaselines("t1", "repo", [baseline("a", 1)]);
    const [file] = await listFiles(dir);
    await fs.writeFile(path.join(dir, file), "{not json");
    await expect(
      store.getBaselines("t1", "repo", [{ ecosystem: "npm", package: "a" }]),
    ).rejects.toMatchObject({ code: "STORAGE_FAILURE" });
  });

  it("refuses a file that holds another key's record", async () => {
    const { dir, store } = await fileStore();
    await store.putReport(report("t1", "scan", 1));
    const [file] = await listFiles(dir);
    const tampered = { ...report("t2", "scan", 1) };
    await fs.writeFile(path.join(dir, file), JSON.stringify(tampered));
    const error = await store.getReport("t1", "repo", "scan").catch((e) => e);
    expect(error).toBeInstanceOf(MaintainerSignalError);
    expect(error.code).toBe("STORAGE_FAILURE");
  });

  it("serializes concurrent baseline writes without losing updates", async () => {
    const { store } = await fileStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.putBaselines("t1", "repo", [baseline(`pkg-${i}`, 1)]),
      ),
    );
    const found = await store.getBaselines(
      "t1",
      "repo",
      Array.from({ length: 20 }, (_, i) => ({
        ecosystem: "npm",
        package: `pkg-${i}`,
      })),
    );
    expect(found).toHaveLength(20);
  });
});
