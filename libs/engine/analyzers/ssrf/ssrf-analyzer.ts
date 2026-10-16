import {
  AnalyzerCapabilities,
  AnalysisResult,
  AnalyzerConfig,
  BaseAnalyzer,
  Finding,
  Language,
  Rule,
  Severity,
} from "../../core/analyzer-interface";
import {
  fileExtension,
  isDeclarationFile,
  isSupportedSsrfFile,
  resolveSsrfOptions,
  ResolvedSsrfOptions,
  SSRF_OPTIONS_KEY,
  SsrfOptions,
  validateSsrfOptions,
} from "./config";
import {
  escapeRegExp,
  LineIndex,
  maskComments,
  maskStringContents,
  readCallArgs,
} from "./lexer";
import {
  notifySafely,
  SsrfAnalysisObserver,
  SsrfSkipReason,
} from "./telemetry";

export const SSRF_RULES = {
  UNVALIDATED_REQUEST: "ssrf-001",
  WEAK_VALIDATION: "ssrf-002",
  CLOUD_METADATA_LOOPBACK: "ssrf-003",
  DISABLED_TLS_VERIFICATION: "ssrf-004",
} as const;

interface SourcePattern {
  kind: string;
  re: RegExp;
}

const BUILTIN_SOURCES: SourcePattern[] = [
  {
    kind: "request-input",
    re: /\b(?:req|request|ctx\.request|ctx|event)\s*\.\s*(?:query|body|params|headers|queryStringParameters)\b/,
  },
  {
    kind: "search-params",
    re: /\b(?:[\w$]*[sS]earchParams|query|params)\s*\.\s*(?:get|getAll)\s*\(/,
  },
  {
    kind: "python-request",
    re: /\brequest\s*\.\s*(?:args|form|values|json|data|GET|POST)\b/,
  },
];

const METADATA_OR_LOOPBACK_RE =
  /\b(?:169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254|127\.0\.0\.1|localhost|0\.0\.0\.0|::1)\b/i;

const RULES: readonly Rule[] = [
  {
    id: SSRF_RULES.UNVALIDATED_REQUEST,
    name: "Unvalidated HTTP request to user-controlled URL",
    description:
      "Performs an HTTP request using an unvalidated or user-controlled URL target, allowing Server-Side Request Forgery (SSRF).",
    severity: Severity.HIGH,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-918", "ssrf"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/918.html",
  },
  {
    id: SSRF_RULES.WEAK_VALIDATION,
    name: "Weak or bypassable SSRF URL validation",
    description:
      "Uses a weak validation pattern (such as protocol startsWith or unparsed substring checks) that does not protect against SSRF.",
    severity: Severity.MEDIUM,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-918", "ssrf", "validation-bypass"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/918.html",
  },
  {
    id: SSRF_RULES.CLOUD_METADATA_LOOPBACK,
    name: "Access to cloud metadata or loopback address",
    description:
      "Request target accesses internal loopback or cloud metadata services (e.g. 169.254.169.254), leading to credential exposure.",
    severity: Severity.CRITICAL,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-918", "ssrf", "cloud-metadata"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/918.html",
  },
  {
    id: SSRF_RULES.DISABLED_TLS_VERIFICATION,
    name: "Disabled TLS certificate verification in HTTP client",
    description:
      "HTTP client options explicitly disable TLS verification (e.g. rejectUnauthorized: false or verify=False).",
    severity: Severity.HIGH,
    category: "security",
    enabled: true,
    tags: ["security", "tls", "ssrf", "cwe-295"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/295.html",
  },
];

export interface SsrfAnalyzerOptions {
  observer?: SsrfAnalysisObserver;
}

export class SsrfAnalyzer extends BaseAnalyzer {
  static readonly NAME = "ssrf";
  static readonly VERSION = "1.0.0";

  private readonly observer?: SsrfAnalysisObserver;

  constructor(options: SsrfAnalyzerOptions = {}) {
    super();
    this.observer = options.observer;
  }

  getName(): string {
    return SsrfAnalyzer.NAME;
  }

  getVersion(): string {
    return SsrfAnalyzer.VERSION;
  }

  supportsLanguage(language: Language | string): boolean {
    return (
      language === Language.JAVASCRIPT ||
      language === Language.TYPESCRIPT ||
      language === "js" ||
      language === "ts" ||
      language === "python" ||
      language === "py"
    );
  }

  getSupportedLanguages(): Language[] {
    return [Language.JAVASCRIPT, Language.TYPESCRIPT];
  }

  getRules(): Rule[] {
    return RULES.map((r) => ({ ...r, tags: r.tags ? [...r.tags] : undefined }));
  }

  getRule(ruleId: string): Rule | undefined {
    return this.getRules().find((r) => r.id === ruleId);
  }

  getCapabilities(): AnalyzerCapabilities {
    return {
      ...super.getCapabilities(),
      securityAnalysis: true,
      cwe: ["CWE-918", "CWE-295"],
      fileExtensions: [
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".py",
      ],
    };
  }

  validateConfig(config: AnalyzerConfig): string[] {
    const errors = super.validateConfig(config);
    const severities = new Set<string>(Object.values(Severity));
    for (const [ruleId, rc] of Object.entries(config.rules ?? {})) {
      if (rc === null || (typeof rc !== "boolean" && typeof rc !== "object")) {
        errors.push(`Rule ${ruleId} config must be a boolean or an object`);
      } else if (
        typeof rc === "object" &&
        rc.severity !== undefined &&
        !severities.has(rc.severity)
      ) {
        errors.push(`Rule ${ruleId} has unknown severity: ${String(rc.severity)}`);
      }
    }
    if (
      config.maxFindings !== undefined &&
      (!Number.isInteger(config.maxFindings) || config.maxFindings < 0)
    ) {
      errors.push("maxFindings must be a non-negative integer");
    }
    errors.push(...validateSsrfOptions(config.options?.[SSRF_OPTIONS_KEY]));
    return errors;
  }

  private assertValidConfig(config?: AnalyzerConfig): AnalyzerConfig {
    const cfg = config ?? this.config;
    const errors = this.validateConfig(cfg);
    if (errors.length > 0) {
      throw new Error(`Invalid configuration: ${errors.join(", ")}`);
    }
    return cfg;
  }

  async analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const cfg = this.assertValidConfig(config);
    if (!this.initialized) await this.initialize(config);
    const opts = resolveSsrfOptions(
      cfg.options?.[SSRF_OPTIONS_KEY] as SsrfOptions | undefined,
    );

    const skip = (reason: SsrfSkipReason, message?: string): AnalysisResult => {
      const file = typeof filePath === "string" ? filePath : "<invalid>";
      notifySafely(() => this.observer?.onFileSkipped?.({ file, reason }));
      return {
        findings: [],
        filesAnalyzed: 0,
        analysisTime: Date.now() - startTime,
        analyzerVersion: SsrfAnalyzer.VERSION,
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        errors: message ? [{ file, message }] : undefined,
      };
    };

    if (typeof code !== "string" || typeof filePath !== "string") {
      return skip("invalid-input", "code and filePath must be strings");
    }

    if (isDeclarationFile(filePath)) {
      return skip("declaration-file");
    }

    if (!isSupportedSsrfFile(filePath)) {
      return skip("unsupported-file-type");
    }

    const byteLength = Buffer.byteLength(code, "utf8");
    if (byteLength > opts.maxFileBytes) {
      return skip(
        "file-too-large",
        `File size (${byteLength} bytes) exceeds limit (${opts.maxFileBytes} bytes)`,
      );
    }

    if (code.includes("\0")) {
      return skip("binary-content", "Binary content detected (null byte present)");
    }

    const findings = this.scanFile(code, filePath, cfg, opts);
    const durationMs = Date.now() - startTime;

    const findingsByRule: Record<string, number> = {};
    for (const f of findings) {
      findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] ?? 0) + 1;
    }

    notifySafely(() =>
      this.observer?.onFileAnalyzed?.({
        file: filePath,
        durationMs,
        findingsByRule,
      }),
    );

    return {
      findings,
      filesAnalyzed: 1,
      analysisTime: durationMs,
      analyzerVersion: SsrfAnalyzer.VERSION,
      summary: this.computeSummary(findings),
    };
  }

  private scanFile(
    code: string,
    filePath: string,
    config: AnalyzerConfig,
    opts: ResolvedSsrfOptions,
  ): Finding[] {
    const lines = new LineIndex(code);
    const masked = maskComments(code);
    const findings: Finding[] = [];

    const isRuleActive = (ruleId: string): boolean => {
      const entry = config.rules?.[ruleId];
      if (entry === false) return false;
      if (typeof entry === "object" && entry.enabled === false) return false;
      return true;
    };

    const ruleSeverity = (ruleId: string, defaultSev: Severity): Severity => {
      const entry = config.rules?.[ruleId];
      if (typeof entry === "object" && entry.severity) return entry.severity;
      return defaultSev;
    };

    // 1. Scan for Cloud Metadata & Loopback access (ssrf-003)
    if (isRuleActive(SSRF_RULES.CLOUD_METADATA_LOOPBACK)) {
      const metaMatches = this.findMetadataAccess(masked, lines, filePath);
      for (const m of metaMatches) {
        findings.push({
          ruleId: SSRF_RULES.CLOUD_METADATA_LOOPBACK,
          message: `Request target references cloud metadata or loopback address (${m.target}), which can expose internal infrastructure or credentials.`,
          severity: ruleSeverity(
            SSRF_RULES.CLOUD_METADATA_LOOPBACK,
            Severity.CRITICAL,
          ),
          location: {
            file: filePath,
            startLine: m.line,
            endLine: m.line,
            startColumn: m.column,
          },
          suggestedFix: {
            description:
              "Disallow requests to internal, loopback (127.0.0.1, localhost) and metadata IP ranges (169.254.169.254).",
          },
        });
      }
    }

    // 2. Scan for Disabled TLS Verification (ssrf-004)
    if (isRuleActive(SSRF_RULES.DISABLED_TLS_VERIFICATION)) {
      const tlsMatches = this.findDisabledTlsVerification(masked, lines, filePath);
      for (const m of tlsMatches) {
        findings.push({
          ruleId: SSRF_RULES.DISABLED_TLS_VERIFICATION,
          message: `HTTP client options disable TLS certificate validation (${m.matched}), exposing connections to man-in-the-middle attacks.`,
          severity: ruleSeverity(
            SSRF_RULES.DISABLED_TLS_VERIFICATION,
            Severity.HIGH,
          ),
          location: {
            file: filePath,
            startLine: m.line,
            endLine: m.line,
            startColumn: m.column,
          },
          suggestedFix: {
            description:
              "Remove rejectUnauthorized: false or verify=False to enforce TLS certificate verification.",
          },
        });
      }
    }

    // 3. Scan for Weak / Bypassable URL Validation (ssrf-002)
    if (isRuleActive(SSRF_RULES.WEAK_VALIDATION)) {
      const weakMatches = this.findWeakValidation(masked, lines, filePath);
      for (const m of weakMatches) {
        findings.push({
          ruleId: SSRF_RULES.WEAK_VALIDATION,
          message: `Weak SSRF validation pattern (${m.reason}): '${m.snippet}' can be bypassed by attacker-crafted domains or query parameters.`,
          severity: ruleSeverity(SSRF_RULES.WEAK_VALIDATION, Severity.MEDIUM),
          location: {
            file: filePath,
            startLine: m.line,
            endLine: m.line,
            startColumn: m.column,
          },
          suggestedFix: {
            description:
              "Parse the URL and validate the hostname against a strict allowlist using validateUrlForSsrf.",
          },
        });
      }
    }

    // 4. Scan for Unvalidated HTTP Requests (ssrf-001)
    if (isRuleActive(SSRF_RULES.UNVALIDATED_REQUEST)) {
      const taintMap = this.collectTaint(masked, opts);
      const sinkCalls = this.findHttpSinks(masked, lines, opts);

      for (const sink of sinkCalls) {
        // If within proximity lines there is a call to a safe validator, skip finding
        if (this.hasValidatorInProximity(masked, lines, sink.line, opts)) {
          continue;
        }

        // Check if sink target argument is tainted by user input or carries url param
        const isTainted = this.isArgumentTainted(sink.targetArg, taintMap, masked);
        if (isTainted) {
          findings.push({
            ruleId: SSRF_RULES.UNVALIDATED_REQUEST,
            message: `Unvalidated HTTP request to '${sink.targetArg}' may allow Server-Side Request Forgery (SSRF). User input is passed directly to an outbound request.`,
            severity: ruleSeverity(SSRF_RULES.UNVALIDATED_REQUEST, Severity.HIGH),
            location: {
              file: filePath,
              startLine: sink.line,
              endLine: sink.line,
              startColumn: sink.column,
            },
            suggestedFix: {
              description:
                "Validate the target URL with validateUrlForSsrf or preventSsrf before making the request.",
            },
          });
        }
      }
    }

    // Sort findings deterministically by line, then column, then ruleId
    findings.sort((a, b) => {
      if (a.location.startLine !== b.location.startLine) {
        return a.location.startLine - b.location.startLine;
      }
      if ((a.location.startColumn ?? 0) !== (b.location.startColumn ?? 0)) {
        return (a.location.startColumn ?? 0) - (b.location.startColumn ?? 0);
      }
      return a.ruleId.localeCompare(b.ruleId);
    });

    if (config.maxFindings !== undefined && findings.length > config.maxFindings) {
      return findings.slice(0, config.maxFindings);
    }

    return findings;
  }

  private findMetadataAccess(
    code: string,
    lines: LineIndex,
    _filePath: string,
  ): Array<{ target: string; line: number; column: number }> {
    const results: Array<{ target: string; line: number; column: number }> = [];
    const re = new RegExp(METADATA_OR_LOOPBACK_RE.source, "gi");
    let match: RegExpExecArray | null;

    while ((match = re.exec(code)) !== null) {
      const pos = lines.position(match.index);
      results.push({
        target: match[0],
        line: pos.line,
        column: pos.column,
      });
    }
    return results;
  }

  private findDisabledTlsVerification(
    code: string,
    lines: LineIndex,
    _filePath: string,
  ): Array<{ matched: string; line: number; column: number }> {
    const results: Array<{ matched: string; line: number; column: number }> = [];
    const tlsPatterns = [
      /\brejectUnauthorized\s*:\s*false\b/g,
      /\bverify\s*=\s*False\b/g,
      /\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/g,
    ];

    for (const pat of tlsPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pat.exec(code)) !== null) {
        const pos = lines.position(match.index);
        results.push({
          matched: match[0],
          line: pos.line,
          column: pos.column,
        });
      }
    }
    return results;
  }

  private findWeakValidation(
    code: string,
    lines: LineIndex,
    _filePath: string,
  ): Array<{ reason: string; snippet: string; line: number; column: number }> {
    const results: Array<{
      reason: string;
      snippet: string;
      line: number;
      column: number;
    }> = [];

    // Protocol startsWith check (e.g. url.startsWith("http://") or startsWith("https://"))
    const protocolRe =
      /\b(?:startsWith|\.startsWith|startswith)\s*\(\s*\(?['"`]https?:\/\/['"`]/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = protocolRe.exec(code)) !== null) {
      const pos = lines.position(pMatch.index);
      results.push({
        reason: "protocol prefix check allows arbitrary hosts",
        snippet: pMatch[0],
        line: pos.line,
        column: pos.column,
      });
    }

    // Substring host check without URL parsing (e.g. url.indexOf("example.com") !== -1 or url.includes("example.com"))
    const substringRe =
      /\.(?:indexOf|includes)\s*\(\s*['"`](?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}['"`]\s*\)/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = substringRe.exec(code)) !== null) {
      // If code preceding this line within 3 lines contains new URL( or urlparse, it might be parsing
      const pos = lines.position(sMatch.index);
      results.push({
        reason: "unparsed substring check can match subdomains or path query parameters",
        snippet: sMatch[0],
        line: pos.line,
        column: pos.column,
      });
    }

    return results;
  }

  private collectTaint(code: string, opts: ResolvedSsrfOptions): Set<string> {
    const tainted = new Set<string>();
    const sources = [...BUILTIN_SOURCES];

    for (const src of opts.additionalSources) {
      sources.push({
        kind: "custom",
        re: new RegExp(`\\b${escapeRegExp(src)}\\b`),
      });
    }

    // Direct variable assignments: const url = req.query.url / request.args.get("url")
    const assignRe =
      /(?:(?:const|let|var)\s+([\w$]+)\s*=\s*([^;\n]+)|([\w$]+)\s*=\s*([^;\n]+))/g;
    let match: RegExpExecArray | null;

    while ((match = assignRe.exec(code)) !== null) {
      const varName = match[1] || match[3];
      const rhs = match[2] || match[4];
      if (!varName || !rhs) continue;

      for (const src of sources) {
        if (src.re.test(rhs)) {
          tainted.add(varName);
          break;
        }
      }

      // Propagate if rhs contains an already tainted identifier
      for (const t of tainted) {
        const idRe = new RegExp(`\\b${escapeRegExp(t)}\\b`);
        if (idRe.test(rhs)) {
          tainted.add(varName);
          break;
        }
      }
    }

    return tainted;
  }

  private findHttpSinks(
    code: string,
    lines: LineIndex,
    opts: ResolvedSsrfOptions,
  ): Array<{ targetArg: string; line: number; column: number }> {
    const sinks: Array<{ targetArg: string; line: number; column: number }> = [];

    const sinkPatterns = [
      // fetch(url, ...)
      /\bfetch\s*\(/g,
      // axios.get(url, ...) or axios(url, ...)
      /\baxios(?:\.(?:get|post|put|delete|patch|head|options|request))?\s*\(/g,
      // http.get(url, ...) or https.request(url, ...)
      /\b(?:https?|http)\s*\.(?:get|request)\s*\(/g,
      // got(url, ...)
      /\bgot(?:\.(?:get|post|put|delete))?\s*\(/g,
      // superagent.get(url)
      /\bsuperagent\s*\.(?:get|post|put|del)\s*\(/g,
      // needle.get(url)
      /\bneedle\s*\.(?:get|post)\s*\(/g,
      // urllib.request(url)
      /\burllib\s*\.request\s*\(/g,
      // Python: requests.get(url, ...)
      /\brequests\s*\.(?:get|post|put|delete|patch|head|options|request)\s*\(/g,
      // Python: urllib.request.urlopen(url)
      /\burllib\.request\.urlopen\s*\(/g,
      // Python: httpx.get(url)
      /\bhttpx\s*\.(?:get|post|request)\s*\(/g,
      // Python: aiohttp session
      /\b(?:session|client)\s*\.(?:get|post)\s*\(/g,
    ];

    for (const customSink of opts.additionalSinks) {
      sinkPatterns.push(new RegExp(`\\b${escapeRegExp(customSink)}\\s*\\(`, "g"));
    }

    for (const pat of sinkPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pat.exec(code)) !== null) {
        const openParenIndex = match.index + match[0].length;
        const callArgs = readCallArgs(code, openParenIndex);
        if (callArgs.args.length > 0) {
          const firstArg = callArgs.args[0].text;
          const pos = lines.position(match.index);
          sinks.push({
            targetArg: firstArg,
            line: pos.line,
            column: pos.column,
          });
        }
      }
    }

    return sinks;
  }

  private hasValidatorInProximity(
    code: string,
    lines: LineIndex,
    sinkLine: number,
    opts: ResolvedSsrfOptions,
  ): boolean {
    const startLine = Math.max(1, sinkLine - opts.proximityLines);
    const endLine = sinkLine;

    // Split code lines
    const allLines = code.split("\n");
    const window = allLines.slice(startLine - 1, endLine).join("\n");

    for (const val of opts.safeValidators) {
      const valRe = new RegExp(`\\b${escapeRegExp(val)}\\s*\\(`, "i");
      if (valRe.test(window)) {
        return true;
      }
    }

    return false;
  }

  private isArgumentTainted(
    arg: string,
    taintSet: Set<string>,
    code: string,
  ): boolean {
    const trimmed = arg.trim();

    // Constant string literals starting with http/https are safe unless loopback/metadata
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return false;
    }

    // Check direct request source patterns inside the argument
    for (const src of BUILTIN_SOURCES) {
      if (src.re.test(trimmed)) return true;
    }

    // Check if the argument references any tainted variable
    for (const t of taintSet) {
      const tRe = new RegExp(`\\b${escapeRegExp(t)}\\b`);
      if (tRe.test(trimmed)) return true;
    }

    // Common dangerous parameter names passed directly to fetch:
    // e.g. targetUrl, webhookUrl, remoteUrl, userUrl, callbackUrl
    if (
      /\b(?:targetUrl|webhookUrl|remoteUrl|apiUrl|feedUrl|userUrl|destUrl|requestedUrl|externalUrl)\b/i.test(
        trimmed,
      )
    ) {
      return true;
    }

    return false;
  }

  private computeSummary(findings: Finding[]) {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) {
      if (f.severity in summary) {
        summary[f.severity]++;
      }
    }
    return summary;
  }
}
