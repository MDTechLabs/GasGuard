import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { DEFAULT_CONFIG } from "./config.interface";
import {
  isPathExcluded,
  loadConfig,
  mergeConfig,
  parseConfigContent,
  parseSimpleYaml,
} from "./config-loader";

describe("config-loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gasguardrc-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to defaults when no config file is present", () => {
    expect(loadConfig(tmpDir)).toEqual(DEFAULT_CONFIG);
  });

  it("reads overrides from a .gasguardrc.json file", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gasguardrc.json"),
      JSON.stringify({
        ignoreRules: ["cached-length"],
        excludePaths: ["legacy/"],
        severityThreshold: "high",
      }),
    );

    const config = loadConfig(tmpDir);
    expect(config.ignoreRules).toEqual(["cached-length"]);
    expect(config.excludePaths).toEqual(["legacy/"]);
    expect(config.severityThreshold).toBe("high");
    // Untouched fields keep their defaults.
    expect(config.includePaths).toEqual(DEFAULT_CONFIG.includePaths);
  });

  it("reads overrides from a .gasguardrc.yaml file", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gasguardrc.yaml"),
      [
        "severityThreshold: medium",
        "ignoreRules:",
        "  - rule-a",
        "  - rule-b",
        "excludePaths:",
        '  - "contracts/legacy/"',
      ].join("\n"),
    );

    const config = loadConfig(tmpDir);
    expect(config.severityThreshold).toBe("medium");
    expect(config.ignoreRules).toEqual(["rule-a", "rule-b"]);
    expect(config.excludePaths).toEqual(["contracts/legacy/"]);
  });

  it("ignores an invalid severityThreshold and keeps the default", () => {
    const merged = mergeConfig({ severityThreshold: "nonsense" as never });
    expect(merged.severityThreshold).toBe(DEFAULT_CONFIG.severityThreshold);
  });

  it("parses an extensionless .gasguardrc as JSON then YAML", () => {
    expect(parseConfigContent(".gasguardrc", '{"ignoreRules":["x"]}')).toEqual({
      ignoreRules: ["x"],
    });
    expect(parseConfigContent(".gasguardrc", "severityThreshold: low")).toEqual(
      {
        severityThreshold: "low",
      },
    );
  });

  it("parses simple YAML scalars and lists", () => {
    const parsed = parseSimpleYaml("a: 1\nlist:\n  - one\n  - two\n");
    expect(parsed).toEqual({ a: "1", list: ["one", "two"] });
  });

  it("detects excluded paths so they can be skipped during parsing", () => {
    const config = { ...DEFAULT_CONFIG, excludePaths: ["legacy/", "vendor"] };
    expect(isPathExcluded("legacy/Token.sol", config)).toBe(true);
    expect(isPathExcluded("./src/vendor/lib.rs", config)).toBe(true);
    expect(isPathExcluded("src/main.sol", config)).toBe(false);
  });
});
