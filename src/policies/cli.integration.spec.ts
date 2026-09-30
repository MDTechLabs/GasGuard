import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { runPolicyValidateCli } from "./cli";
import { PolicyLoadError, loadPolicyFile } from "./load";
import { POLICY_LIMITS } from "./types";
import { validatePolicy } from "./validate";

const SECRET = "SUPER_SECRET_POLICY_NOTE";
const repoRoot = path.resolve(__dirname, "../..");
const productionPolicy = path.join(
  repoRoot,
  "config",
  "policies",
  "production.policy.json",
);

function writePolicy(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gasguard-policy-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function capture(argv: string[], env?: NodeJS.ProcessEnv) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const previous = process.env.GASGUARD_POLICY_DEBUG;
  if (env?.GASGUARD_POLICY_DEBUG === undefined) {
    delete process.env.GASGUARD_POLICY_DEBUG;
  } else {
    process.env.GASGUARD_POLICY_DEBUG = env.GASGUARD_POLICY_DEBUG;
  }
  let ticks = 0;
  const times = [1_000, 1_025];
  const code = runPolicyValidateCli(argv, {
    stdout: (chunk) => stdout.push(chunk),
    stderr: (chunk) => stderr.push(chunk),
    now: () => times[Math.min(ticks++, times.length - 1)] ?? 1_025,
    correlationId: "pol_test",
  });
  if (previous === undefined) {
    delete process.env.GASGUARD_POLICY_DEBUG;
  } else {
    process.env.GASGUARD_POLICY_DEBUG = previous;
  }
  return {
    code,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

describe("policy validate command", () => {
  it("validates the checked-in production policy with no warnings", () => {
    const loaded = loadPolicyFile(productionPolicy);
    const result = validatePolicy(loaded.raw);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.policy?.name).toBe("production");
    expect(loaded.bytesRead).toBeGreaterThan(0);
  });

  it("prints a text pass report and keeps the policy body out of the log", () => {
    const filePath = writePolicy(
      "team.policy.json",
      JSON.stringify({
        schemaVersion: "1",
        name: "team",
        version: "1.2.3",
        description: SECRET,
        mode: "enforce",
        gates: { minSeverity: "high", maxFindings: 0 },
      }),
    );

    const result = capture([filePath]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Policy validation passed");
    expect(result.stdout).toContain("correlationId: pol_test");
    expect(result.stdout).toContain("durationMs: 25");
    expect(result.stdout).not.toContain(SECRET);

    const logs = result.stderr
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logs.map((entry) => entry.event)).toEqual([
      "policy.validate.start",
      "policy.validate.complete",
    ]);
    expect(logs[1]).toMatchObject({
      correlationId: "pol_test",
      outcome: "pass",
      errorCount: 0,
      durationMs: 25,
      component: "policy.validate",
    });
    expect(result.stderr).not.toContain(SECRET);
  });

  it("returns JSON for a schema failure and exits 1", () => {
    const filePath = writePolicy(
      "broken.policy.json",
      JSON.stringify({ schemaVersion: "1", name: "broken" }),
    );

    const result = capture(["validate", filePath, "--format=json"]);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout) as {
      valid: boolean;
      errors: Array<{ code: string }>;
      metrics: { outcome: string; durationMs: number; bytesRead: number };
      correlationId: string;
    };
    expect(report.valid).toBe(false);
    expect(report.correlationId).toBe("pol_test");
    expect(report.metrics).toMatchObject({ outcome: "fail", durationMs: 25 });
    expect(report.metrics.bytesRead).toBeGreaterThan(0);
    expect(report.errors.map((error) => error.code)).toContain("MISSING_GATES");
    expect(result.stderr).toContain('"outcome":"fail"');
  });

  it("promotes warnings to errors in strict mode", () => {
    const filePath = writePolicy(
      "loose.policy.json",
      JSON.stringify({
        schemaVersion: "1",
        name: "loose",
        version: "1.0.0",
        gates: {},
      }),
    );

    const relaxed = capture([filePath, "--format", "json"]);
    expect(relaxed.code).toBe(0);
    const relaxedReport = JSON.parse(relaxed.stdout) as { valid: boolean };
    expect(relaxedReport.valid).toBe(true);

    const strict = capture([filePath, "--format", "json", "--strict"]);
    expect(strict.code).toBe(1);
    const report = JSON.parse(strict.stdout) as {
      valid: boolean;
      policy?: unknown;
      errors: Array<{ message: string }>;
    };
    expect(report.valid).toBe(false);
    expect(report.policy).toBeUndefined();
    expect(
      report.errors.some((error) => error.message.includes("--strict")),
    ).toBe(true);
  });

  it("exits 2 for usage errors without reading a policy body", () => {
    expect(capture(["--help"]).code).toBe(0);
    expect(capture(["-h"]).stdout).toContain("Exit codes:");

    const missing = capture(["--format", "json"]);
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout).errors[0].code).toBe("INVALID_ARGUMENTS");

    const unknown = capture(["policy.json", "--yaml"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toContain("Unknown option");

    const twoFiles = capture(["a.json", "b.json"]);
    expect(twoFiles.code).toBe(2);
    expect(twoFiles.stdout).toContain("Only one policy file");
  });

  it("fails closed on missing, empty, non-file, malformed, and unsupported inputs", () => {
    const missing = capture([
      path.join(os.tmpdir(), "does-not-exist-policy.json"),
      "--format",
      "json",
    ]);
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout).errors[0].code).toBe("FILE_NOT_FOUND");

    const empty = writePolicy("empty.policy.json", "");
    expect(
      JSON.parse(capture([empty, "--format", "json"]).stdout).errors[0].code,
    ).toBe("EMPTY_FILE");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gasguard-policy-dir-"));
    const asDir = capture([
      path.join(dir, "..", path.basename(dir)),
      "--format",
      "json",
    ]);
    expect(asDir.code).toBe(2);
    expect(JSON.parse(asDir.stdout).errors[0].code).toBe("NOT_A_FILE");

    const badJson = writePolicy(
      "bad.policy.json",
      '{"token":"sk-secret-value"',
    );
    const badJsonResult = capture([badJson, "--format", "json"]);
    expect(JSON.parse(badJsonResult.stdout).errors[0].code).toBe(
      "INVALID_JSON",
    );
    expect(badJsonResult.stdout + badJsonResult.stderr).not.toContain(
      "sk-secret-value",
    );

    const yaml = writePolicy("policy.yaml", "mode: enforce\n");
    expect(
      JSON.parse(capture([yaml, "--format", "json"]).stdout).errors[0].code,
    ).toBe("UNSUPPORTED_FORMAT");

    const extensionless = writePolicy("gasguard.policy", "{}");
    expect(
      JSON.parse(capture([extensionless, "--format", "json"]).stdout).errors[0]
        .code,
    ).toBe("UNSUPPORTED_FORMAT");
  });

  it("rejects a file one byte over the size cap and still parses a file at the cap", () => {
    const over = writePolicy(
      "over.policy.json",
      " ".repeat(POLICY_LIMITS.maxBytes + 1),
    );
    expect(
      JSON.parse(capture([over, "--format", "json"]).stdout).errors[0].code,
    ).toBe("FILE_TOO_LARGE");

    const atCap = writePolicy(
      "cap.policy.json",
      " ".repeat(POLICY_LIMITS.maxBytes),
    );
    expect(
      JSON.parse(capture([atCap, "--format", "json"]).stdout).errors[0].code,
    ).toBe("INVALID_JSON");
  });

  it("accepts a UTF-8 BOM in front of a valid document", () => {
    const filePath = writePolicy(
      "bom.policy.json",
      `\uFEFF${JSON.stringify({
        schemaVersion: "1",
        name: "bom",
        version: "1.0.0",
        mode: "warn",
        gates: { minSeverity: "critical", maxFindings: 0 },
      })}`,
    );

    expect(capture([filePath]).code).toBe(0);
  });

  it("does not leak unexpected loader errors unless debug logging is enabled", () => {
    const secret = "disk-secret-token";
    const stdout: string[] = [];
    const stderr: string[] = [];
    const run = () =>
      runPolicyValidateCli(["policy.json", "--format", "json"], {
        stdout: (chunk) => stdout.push(chunk),
        stderr: (chunk) => stderr.push(chunk),
        correlationId: "pol_test",
        load: () => {
          throw new Error(secret);
        },
      });

    const previous = process.env.GASGUARD_POLICY_DEBUG;
    delete process.env.GASGUARD_POLICY_DEBUG;
    try {
      expect(run()).toBe(2);
      expect(stdout.join("") + stderr.join("")).not.toContain(secret);
      expect(JSON.parse(stdout.join("")).errors[0].code).toBe("INTERNAL_ERROR");

      stdout.length = 0;
      stderr.length = 0;
      process.env.GASGUARD_POLICY_DEBUG = "1";
      expect(run()).toBe(2);
      expect(stderr.join("")).toContain(secret);
      expect(stdout.join("")).not.toContain(secret);
    } finally {
      if (previous === undefined) {
        delete process.env.GASGUARD_POLICY_DEBUG;
      } else {
        process.env.GASGUARD_POLICY_DEBUG = previous;
      }
    }
  });

  it("runs the script end to end against the production policy", () => {
    const result = spawnSync(
      process.execPath,
      [
        "-r",
        "ts-node/register/transpile-only",
        path.join(repoRoot, "scripts", "policy-validate.ts"),
        productionPolicy,
        "--strict",
        "--format",
        "json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          TS_NODE_TRANSPILE_ONLY: "1",
        },
      },
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      valid: boolean;
      policy: { name: string };
      metrics: { strict: boolean; outcome: string };
    };
    expect(report.valid).toBe(true);
    expect(report.policy.name).toBe("production");
    expect(report.metrics).toMatchObject({ strict: true, outcome: "pass" });
    expect(result.stderr).toContain("policy.validate.complete");
    expect(result.stderr).not.toContain("Fail the build");
  }, 60_000);
});

describe("loadPolicyFile", () => {
  it("throws PolicyLoadError for a missing file", () => {
    expect(() =>
      loadPolicyFile(path.join(os.tmpdir(), "missing-policy.json")),
    ).toThrow(PolicyLoadError);
  });
});
