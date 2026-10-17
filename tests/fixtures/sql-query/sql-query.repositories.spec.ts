import * as fs from "fs";
import * as path from "path";
import { SqlQueryAnalyzer } from "../../../libs/engine/analyzers/sql-query";

const FIXTURES_DIR = path.resolve(__dirname);

function loadFixtureFiles(subDir: string): Array<{ path: string; content: string }> {
  const dir = path.join(FIXTURES_DIR, subDir);
  const results: Array<{ path: string; content: string }> = [];

  const walk = (current: string) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(dir, full).replace(/\\/g, "/");
        results.push({ path: rel, content: fs.readFileSync(full, "utf8") });
      }
    }
  };

  walk(dir);
  return results;
}

describe("SQL Query repository fixtures", () => {
  let analyzer: SqlQueryAnalyzer;

  beforeEach(() => {
    analyzer = new SqlQueryAnalyzer();
  });

  it("detects SQL injection weaknesses in vulnerable-app", async () => {
    const files = loadFixtureFiles("vulnerable-app");
    const fileMap = new Map<string, string>(files.map((f) => [f.path, f.content]));

    const result = await analyzer.analyzeMultiple(fileMap);

    expect(result.filesAnalyzed).toBeGreaterThanOrEqual(2);
    expect(result.findings.length).toBeGreaterThan(0);

    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has("sql-001")).toBe(true);
    expect(ruleIds.has("sql-002")).toBe(true);
    expect(ruleIds.has("sql-003")).toBe(true);
    expect(ruleIds.has("sql-004")).toBe(true);
  });

  it("produces 0 findings on safe-app", async () => {
    const files = loadFixtureFiles("safe-app");
    const fileMap = new Map<string, string>(files.map((f) => [f.path, f.content]));

    const result = await analyzer.analyzeMultiple(fileMap);
    expect(result.findings).toHaveLength(0);
  });
});
