import fs from "fs-extra";
import os from "os";
import path from "path";
import { generateJsonReport } from "../reporting/json-reporter";
import { setCliOptions } from "../output";
import { runScan } from "./scan";

jest.mock("../reporting/json-reporter", () => ({
  generateJsonReport: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../reporting/sarif-reporter", () => ({
  generateSarifReport: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../reporting/summary-printer", () => ({
  printSummary: jest.fn(),
}));

describe("runScan", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "gasguard-cli-scan-"));
    setCliOptions({ quiet: true });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    setCliOptions({});
    await fs.remove(directory);
  });

  it("applies inherited scan patterns and maxFiles while preserving report output", async () => {
    await fs.ensureDir(path.join(directory, "contracts"));
    await fs.ensureDir(path.join(directory, "vendor"));
    await fs.writeFile(
      path.join(directory, "contracts/A.sol"),
      "contract A {}",
    );
    await fs.writeFile(
      path.join(directory, "contracts/B.sol"),
      "contract B {}",
    );
    await fs.writeFile(path.join(directory, "vendor/C.sol"), "contract C {}");
    await fs.writeJson(path.join(directory, "base.json"), {
      scan: { include: ["**/*.sol"], exclude: [], maxFiles: 2 },
      output: { format: "json" },
    });
    const configPath = path.join(directory, "gasguard.config.json");
    await fs.writeJson(configPath, {
      extends: "./base.json",
      scan: { exclude: ["vendor/**"] },
    });

    await runScan(directory, {
      confidence: "0.7",
      output: path.join(directory, "report.json"),
      config: configPath,
    });

    expect(generateJsonReport).toHaveBeenCalledTimes(1);
    expect(generateJsonReport).toHaveBeenCalledWith(
      expect.objectContaining({ totalFiles: 2, scannedFiles: 2 }),
      path.join(directory, "report.json"),
    );
  });

  it("rejects invalid confidence thresholds", async () => {
    await expect(
      runScan(directory, { confidence: "1.01", format: "text" }),
    ).rejects.toThrow("Confidence threshold must be between 0 and 1");
  });

  it("rejects invalid configured file limits instead of disabling the limit", async () => {
    const configPath = path.join(directory, "invalid-limit.json");
    await fs.writeJson(configPath, { scan: { maxFiles: 0 } });

    await expect(
      runScan(directory, { config: configPath, format: "text" }),
    ).rejects.toThrow("scan.maxFiles must be a positive safe integer");
  });
});
