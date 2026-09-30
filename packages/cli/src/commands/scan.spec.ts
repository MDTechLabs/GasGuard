/// <reference types="jest" />

import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import {
  analyzeRepositoryFiles,
  collectScannableFiles,
  RepositoryAnalysisError,
  scanCommand,
} from "./scan";

describe("local repository analysis preflight", () => {
  let repositoryPath: string;

  beforeEach(async () => {
    repositoryPath = await mkdtemp(path.join(os.tmpdir(), "gasguard-scan-"));
  });

  afterEach(async () => {
    await rm(repositoryPath, { recursive: true, force: true });
  });

  it("collects supported source files and ignores generated directories", async () => {
    await mkdir(path.join(repositoryPath, "src"));
    await mkdir(path.join(repositoryPath, "node_modules", "vendor"), {
      recursive: true,
    });
    await writeFile(path.join(repositoryPath, "src", "contract.sol"), "1234");
    await writeFile(
      path.join(repositoryPath, "node_modules", "vendor", "ignored.sol"),
      "ignored",
    );
    await writeFile(path.join(repositoryPath, "README.md"), "documentation");

    await expect(
      collectScannableFiles(repositoryPath, { maxFiles: 1, maxBytes: 4 }),
    ).resolves.toEqual([path.join(repositoryPath, "src", "contract.sol")]);
  });

  it("accepts repositories exactly at both configured limits", async () => {
    await writeFile(path.join(repositoryPath, "first.rs"), "1234");
    await writeFile(path.join(repositoryPath, "second.sol"), "56");

    const files = await collectScannableFiles(repositoryPath, {
      maxFiles: 2,
      maxBytes: 6,
    });

    expect(files).toHaveLength(2);
  });

  it("rejects repositories over the file-count limit", async () => {
    await writeFile(path.join(repositoryPath, "first.rs"), "");
    await writeFile(path.join(repositoryPath, "second.sol"), "");

    await expect(
      collectScannableFiles(repositoryPath, { maxFiles: 1, maxBytes: 1 }),
    ).rejects.toMatchObject<Partial<RepositoryAnalysisError>>({
      code: "FILE_LIMIT_EXCEEDED",
    });
  });

  it("rejects repositories over the byte limit", async () => {
    await writeFile(path.join(repositoryPath, "contract.vy"), "12345");

    await expect(
      collectScannableFiles(repositoryPath, { maxFiles: 1, maxBytes: 4 }),
    ).rejects.toMatchObject<Partial<RepositoryAnalysisError>>({
      code: "SIZE_LIMIT_EXCEEDED",
    });
  });

  it("stops before walking when cancellation was requested", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      collectScannableFiles(repositoryPath, {}, controller.signal),
    ).rejects.toMatchObject<Partial<RepositoryAnalysisError>>({
      code: "ANALYSIS_CANCELLED",
    });
  });

  it("reports inaccessible repository paths instead of silently scanning nothing", async () => {
    await expect(
      collectScannableFiles(path.join(repositoryPath, "missing")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exposes the local analyzer bootstrap as a scan alias", () => {
    expect(scanCommand.aliases()).toContain("analyze-local");
  });

  it("runs the Rust analyzer and reports its actual findings", async () => {
    const sourcePath = path.join(repositoryPath, "contract.rs");
    await writeFile(
      sourcePath,
      'fn main() { let value = String::from("gas"); let copy = value.clone(); }',
    );

    const result = await analyzeRepositoryFiles([sourcePath], repositoryPath);

    expect(result.scannedFiles).toBe(1);
    expect(
      result.findings.some((finding) => finding.ruleId === "rust-002"),
    ).toBe(true);
    expect(result.summary.totalViolations).toBe(result.findings.length);
  });

  it("analyzes read-only repository snapshots without modifying source files", async () => {
    const sourcePath = path.join(repositoryPath, "contract.sol");
    await writeFile(
      sourcePath,
      "contract Sample { function read() public {} }",
    );
    const before = await listSnapshot(repositoryPath);

    await analyzeRepositoryFiles([sourcePath], repositoryPath);

    expect(await listSnapshot(repositoryPath)).toEqual(before);
  });

  it("cancels between files without returning a partial report", async () => {
    const sourcePath = path.join(repositoryPath, "contract.rs");
    await writeFile(sourcePath, "fn main() {}");
    const controller = new AbortController();
    controller.abort();

    await expect(
      analyzeRepositoryFiles([sourcePath], repositoryPath, controller.signal),
    ).rejects.toMatchObject<Partial<RepositoryAnalysisError>>({
      code: "ANALYSIS_CANCELLED",
    });
  });
});

async function listSnapshot(directory: string): Promise<string[]> {
  const { readdir } = await import("fs/promises");
  return (await readdir(directory)).sort();
}
