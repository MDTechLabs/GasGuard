import { Language, Severity } from "../../core/analyzer-interface";
import { SQL_QUERY_RULES, SqlQueryAnalyzer } from "./sql-query-analyzer";
import { SqlQueryAnalysisMetrics } from "./telemetry";

describe("SqlQueryAnalyzer", () => {
  let analyzer: SqlQueryAnalyzer;

  beforeEach(() => {
    analyzer = new SqlQueryAnalyzer();
  });

  describe("metadata and capabilities", () => {
    it("reports correct name and version", () => {
      expect(analyzer.getName()).toBe("sql-query");
      expect(analyzer.getVersion()).toBe("1.0.0");
    });

    it("supports JS, TS, and Python languages", () => {
      expect(analyzer.supportsLanguage(Language.JAVASCRIPT)).toBe(true);
      expect(analyzer.supportsLanguage(Language.TYPESCRIPT)).toBe(true);
      expect(analyzer.supportsLanguage("js")).toBe(true);
      expect(analyzer.supportsLanguage("ts")).toBe(true);
      expect(analyzer.supportsLanguage("python")).toBe(true);
      expect(analyzer.supportsLanguage("py")).toBe(true);
      expect(analyzer.supportsLanguage("solidity")).toBe(false);
    });

    it("exposes all 4 SQL query rules", () => {
      const rules = analyzer.getRules();
      expect(rules).toHaveLength(4);
      const ruleIds = rules.map((r) => r.id);
      expect(ruleIds).toContain(SQL_QUERY_RULES.CONCATENATED_QUERY);
      expect(ruleIds).toContain(SQL_QUERY_RULES.UNSAFE_RAW_API);
      expect(ruleIds).toContain(SQL_QUERY_RULES.INCOMPLETE_SANITIZATION);
      expect(ruleIds).toContain(SQL_QUERY_RULES.DYNAMIC_IDENTIFIER);
    });

    it("can look up a single rule by id", () => {
      const rule = analyzer.getRule(SQL_QUERY_RULES.CONCATENATED_QUERY);
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe(Severity.CRITICAL);
    });
  });

  describe("Rule sql-001: Concatenated SQL query", () => {
    it("flags db.query with concatenated user input", async () => {
      const code = `
        app.get('/user', async (req, res) => {
          const id = req.query.id;
          const query = "SELECT * FROM users WHERE id = " + id;
          const result = await db.query(query);
          res.json(result);
        });
      `;
      const result = await analyzer.analyze(code, "src/users.ts");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.CONCATENATED_QUERY);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.CRITICAL);
    });

    it("flags template literal interpolation in db.query", async () => {
      const code = `
        export async function findUser(name: string) {
          return db.query(\`SELECT * FROM users WHERE name = '\${name}'\`);
        }
      `;
      const result = await analyzer.analyze(code, "src/repo.ts");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.CONCATENATED_QUERY);
      expect(f.length).toBeGreaterThan(0);
    });

    it("does not flag parameterized query calls", async () => {
      const code = `
        app.get('/user', async (req, res) => {
          const id = req.query.id;
          const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
          res.json(result);
        });
      `;
      const result = await analyzer.analyze(code, "src/users.ts");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.CONCATENATED_QUERY);
      expect(f.length).toBe(0);
    });
  });

  describe("Rule sql-002: Unsafe raw APIs", () => {
    it("flags Prisma $queryRawUnsafe without bindings", async () => {
      const code = `
        prisma.$queryRawUnsafe(rawQuery);
      `;
      const result = await analyzer.analyze(code, "src/prisma.ts");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.UNSAFE_RAW_API);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.HIGH);
    });

    it("flags Python cursor.execute with % formatting", async () => {
      const code = `
        cursor.execute("SELECT * FROM items WHERE id = %s" % item_id)
      `;
      const result = await analyzer.analyze(code, "db.py");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.UNSAFE_RAW_API);
      expect(f.length).toBeGreaterThan(0);
    });
  });

  describe("Rule sql-003: Incomplete sanitization", () => {
    it("flags naive single quote replacement", async () => {
      const code = `
        function escapeSql(val: string) {
          return val.replace(/'/g, "''");
        }
      `;
      const result = await analyzer.analyze(code, "src/escape.ts");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.INCOMPLETE_SANITIZATION);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.MEDIUM);
    });
  });

  describe("Rule sql-004: Dynamic identifier interpolation", () => {
    it("flags dynamic ORDER BY concatenation", async () => {
      const code = `
        const sql = "SELECT * FROM products ORDER BY " + sortColumn;
      `;
      const result = await analyzer.analyze(code, "src/products.ts");
      const f = result.findings.filter((x) => x.ruleId === SQL_QUERY_RULES.DYNAMIC_IDENTIFIER);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.HIGH);
    });
  });

  describe("telemetry and options", () => {
    it("records metrics via observer", async () => {
      const metrics = new SqlQueryAnalysisMetrics();
      const obsAnalyzer = new SqlQueryAnalyzer({ observer: metrics });

      await obsAnalyzer.analyze(
        'prisma.$queryRawUnsafe(rawQuery);',
        "test.ts",
      );

      const snapshot = metrics.snapshot();
      expect(snapshot.filesAnalyzed).toBe(1);
      expect(snapshot.totalFindings).toBeGreaterThan(0);
    });

    it("skips declaration files", async () => {
      const result = await analyzer.analyze("declare function query(sql: string): any;", "types.d.ts");
      expect(result.filesAnalyzed).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});
