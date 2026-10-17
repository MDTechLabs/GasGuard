import { Language, Severity } from "../../core/analyzer-interface";
import { SSRF_RULES, SsrfAnalyzer } from "./ssrf-analyzer";
import { SsrfAnalysisMetrics } from "./telemetry";

describe("SsrfAnalyzer", () => {
  let analyzer: SsrfAnalyzer;

  beforeEach(() => {
    analyzer = new SsrfAnalyzer();
  });

  describe("metadata and capabilities", () => {
    it("reports correct name and version", () => {
      expect(analyzer.getName()).toBe("ssrf");
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

    it("exposes all 4 SSRF rules", () => {
      const rules = analyzer.getRules();
      expect(rules).toHaveLength(4);
      const ruleIds = rules.map((r) => r.id);
      expect(ruleIds).toContain(SSRF_RULES.UNVALIDATED_REQUEST);
      expect(ruleIds).toContain(SSRF_RULES.WEAK_VALIDATION);
      expect(ruleIds).toContain(SSRF_RULES.CLOUD_METADATA_LOOPBACK);
      expect(ruleIds).toContain(SSRF_RULES.DISABLED_TLS_VERIFICATION);
    });

    it("can look up a single rule by id", () => {
      const rule = analyzer.getRule(SSRF_RULES.UNVALIDATED_REQUEST);
      expect(rule).toBeDefined();
      expect(rule?.severity).toBe(Severity.HIGH);
      expect(analyzer.getRule("non-existent")).toBeUndefined();
    });
  });

  describe("Rule ssrf-001: Unvalidated HTTP request", () => {
    it("flags fetch with query input", async () => {
      const code = `
        app.get('/proxy', async (req, res) => {
          const target = req.query.url;
          const resp = await fetch(target);
          res.send(await resp.text());
        });
      `;
      const result = await analyzer.analyze(code, "src/proxy.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.UNVALIDATED_REQUEST);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.HIGH);
    });

    it("flags axios with body input", async () => {
      const code = `
        export async function handler(req: any) {
          const webhookUrl = req.body.url;
          return axios.post(webhookUrl, { data: 123 });
        }
      `;
      const result = await analyzer.analyze(code, "src/webhook.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.UNVALIDATED_REQUEST);
      expect(f.length).toBeGreaterThan(0);
    });

    it("flags Python requests with request.args", async () => {
      const code = `
        @app.route('/fetch')
        def fetch_url():
            target_url = request.args.get('target')
            return requests.get(target_url).text
      `;
      const result = await analyzer.analyze(code, "app.py");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.UNVALIDATED_REQUEST);
      expect(f.length).toBeGreaterThan(0);
    });

    it("does not flag fetch when target is protected by validateUrlForSsrf", async () => {
      const code = `
        app.get('/proxy', async (req, res) => {
          const target = req.query.url;
          await validateUrlForSsrf(target);
          const resp = await fetch(target);
          res.send(await resp.text());
        });
      `;
      const result = await analyzer.analyze(code, "src/proxy.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.UNVALIDATED_REQUEST);
      expect(f.length).toBe(0);
    });

    it("does not flag hardcoded safe URLs", async () => {
      const code = `
        export async function getStatus() {
          return fetch("https://api.github.com/status");
        }
      `;
      const result = await analyzer.analyze(code, "src/status.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.UNVALIDATED_REQUEST);
      expect(f.length).toBe(0);
    });
  });

  describe("Rule ssrf-002: Weak URL validation", () => {
    it("flags protocol-only startsWith checks", async () => {
      const code = `
        function checkUrl(url: string) {
          if (!url.startsWith("https://")) {
            throw new Error("Invalid URL");
          }
        }
      `;
      const result = await analyzer.analyze(code, "src/validator.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.WEAK_VALIDATION);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.MEDIUM);
    });

    it("flags unparsed substring indexOf check on domain", async () => {
      const code = `
        function isAllowed(url: string) {
          return url.indexOf("internal-domain.com") !== -1;
        }
      `;
      const result = await analyzer.analyze(code, "src/check.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.WEAK_VALIDATION);
      expect(f.length).toBeGreaterThan(0);
    });
  });

  describe("Rule ssrf-003: Cloud metadata & loopback access", () => {
    it("flags AWS/GCP metadata IP 169.254.169.254", async () => {
      const code = `
        const metadataUrl = "http://169.254.169.254/latest/meta-data/";
        fetch(metadataUrl);
      `;
      const result = await analyzer.analyze(code, "src/meta.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.CLOUD_METADATA_LOOPBACK);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.CRITICAL);
    });

    it("flags metadata.google.internal access", async () => {
      const code = `
        const gcpMeta = "http://metadata.google.internal/computeMetadata/v1/";
      `;
      const result = await analyzer.analyze(code, "src/gcp.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.CLOUD_METADATA_LOOPBACK);
      expect(f.length).toBeGreaterThan(0);
    });

    it("flags loopback 127.0.0.1", async () => {
      const code = `
        const internalApi = "http://127.0.0.1:8080/admin";
      `;
      const result = await analyzer.analyze(code, "src/admin.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.CLOUD_METADATA_LOOPBACK);
      expect(f.length).toBeGreaterThan(0);
    });
  });

  describe("Rule ssrf-004: Disabled TLS verification", () => {
    it("flags rejectUnauthorized: false in Node https agent", async () => {
      const code = `
        const agent = new https.Agent({
          rejectUnauthorized: false
        });
      `;
      const result = await analyzer.analyze(code, "src/client.ts");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.DISABLED_TLS_VERIFICATION);
      expect(f.length).toBeGreaterThan(0);
      expect(f[0].severity).toBe(Severity.HIGH);
    });

    it("flags verify=False in Python requests", async () => {
      const code = `
        response = requests.get('https://example.com', verify=False)
      `;
      const result = await analyzer.analyze(code, "client.py");
      const f = result.findings.filter((x) => x.ruleId === SSRF_RULES.DISABLED_TLS_VERIFICATION);
      expect(f.length).toBeGreaterThan(0);
    });
  });

  describe("options and metrics observer", () => {
    it("tracks metrics when an observer is passed", async () => {
      const metrics = new SsrfAnalysisMetrics();
      const obsAnalyzer = new SsrfAnalyzer({ observer: metrics });

      await obsAnalyzer.analyze(
        "const u = 'http://169.254.169.254';",
        "test.ts",
      );

      const snapshot = metrics.snapshot();
      expect(snapshot.filesAnalyzed).toBe(1);
      expect(snapshot.totalFindings).toBeGreaterThan(0);
    });

    it("skips declaration files without findings", async () => {
      const result = await analyzer.analyze("declare const x: any;", "types.d.ts");
      expect(result.filesAnalyzed).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});
