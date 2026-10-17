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
  isSupportedSqlFile,
  resolveSqlQueryOptions,
  ResolvedSqlQueryOptions,
  SQL_QUERY_OPTIONS_KEY,
  SqlQueryOptions,
  validateSqlQueryOptions,
} from "./config";
import {
  escapeRegExp,
  LineIndex,
  maskComments,
  readCallArgs,
} from "./lexer";
import {
  notifySafely,
  SqlQueryAnalysisObserver,
  SqlQuerySkipReason,
} from "./telemetry";

export const SQL_QUERY_RULES = {
  CONCATENATED_QUERY: "sql-001",
  UNSAFE_RAW_API: "sql-002",
  INCOMPLETE_SANITIZATION: "sql-003",
  DYNAMIC_IDENTIFIER: "sql-004",
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
    kind: "python-request",
    re: /\b(?:request\s*\.\s*(?:args|form|values|json|data|GET|POST))\b/,
  },
];

const RULES: readonly Rule[] = [
  {
    id: SQL_QUERY_RULES.CONCATENATED_QUERY,
    name: "SQL query constructed with unescaped user input (SQL Injection)",
    description:
      "Constructs a SQL query by concatenating or interpolating untrusted input rather than using parameterized query placeholders (CWE-89).",
    severity: Severity.CRITICAL,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-89", "sql-injection"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/89.html",
  },
  {
    id: SQL_QUERY_RULES.UNSAFE_RAW_API,
    name: "Unsafe raw database query API called without parameter bindings",
    description:
      "Calls an unsafe raw query method (such as $queryRawUnsafe or cursor.execute with string formatting) without parameterized bindings.",
    severity: Severity.HIGH,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-89", "raw-query"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/89.html",
  },
  {
    id: SQL_QUERY_RULES.INCOMPLETE_SANITIZATION,
    name: "Incomplete SQL sanitization allows SQL injection bypass",
    description:
      "Attempts to sanitize SQL values using naive string replacement (e.g. only escaping single quotes or stripping comments) which can be bypassed.",
    severity: Severity.MEDIUM,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-89", "sanitization-bypass"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/89.html",
  },
  {
    id: SQL_QUERY_RULES.DYNAMIC_IDENTIFIER,
    name: "Unquoted dynamic identifier in SQL query",
    description:
      "Dynamically interpolates table or column names (e.g. in ORDER BY, GROUP BY, or FROM clauses) without identifier quoting or allowlisting.",
    severity: Severity.HIGH,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-89", "sql-identifier"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/89.html",
  },
];

export interface SqlQueryAnalyzerOptions {
  observer?: SqlQueryAnalysisObserver;
}

export class SqlQueryAnalyzer extends BaseAnalyzer {
  static readonly NAME = "sql-query";
  static readonly VERSION = "1.0.0";

  private readonly observer?: SqlQueryAnalysisObserver;

  constructor(options: SqlQueryAnalyzerOptions = {}) {
    super();
    this.observer = options.observer;
  }

  getName(): string {
    return SqlQueryAnalyzer.NAME;
  }

  getVersion(): string {
    return SqlQueryAnalyzer.VERSION;
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
      cwe: ["CWE-89"],
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
    errors.push(...validateSqlQueryOptions(config.options?.[SQL_QUERY_OPTIONS_KEY]));
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
    const opts = resolveSqlQueryOptions(
      cfg.options?.[SQL_QUERY_OPTIONS_KEY] as SqlQueryOptions | undefined,
    );

    const skip = (reason: SqlQuerySkipReason, message?: string): AnalysisResult => {
      const file = typeof filePath === "string" ? filePath : "<invalid>";
      notifySafely(() => this.observer?.onFileSkipped?.({ file, reason }));
      return {
        findings: [],
        filesAnalyzed: 0,
        analysisTime: Date.now() - startTime,
        analyzerVersion: SqlQueryAnalyzer.VERSION,
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

    if (!isSupportedSqlFile(filePath)) {
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
      analyzerVersion: SqlQueryAnalyzer.VERSION,
      summary: this.computeSummary(findings),
    };
  }

  private scanFile(
    code: string,
    filePath: string,
    config: AnalyzerConfig,
    opts: ResolvedSqlQueryOptions,
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

    // 1. Scan for Incomplete Sanitization (sql-003)
    if (isRuleActive(SQL_QUERY_RULES.INCOMPLETE_SANITIZATION)) {
      const incompleteMatches = this.findIncompleteSanitization(masked, lines);
      for (const m of incompleteMatches) {
        findings.push({
          ruleId: SQL_QUERY_RULES.INCOMPLETE_SANITIZATION,
          message: `Incomplete SQL escaping pattern (${m.matched}): manual character replacement can be bypassed. Use parameterized queries instead.`,
          severity: ruleSeverity(
            SQL_QUERY_RULES.INCOMPLETE_SANITIZATION,
            Severity.MEDIUM,
          ),
          location: {
            file: filePath,
            startLine: m.line,
            endLine: m.line,
            startColumn: m.column,
          },
          suggestedFix: {
            description:
              "Switch to parameterized query placeholders ($1, ?, :param) instead of string replacement.",
          },
        });
      }
    }

    // 2. Scan for Unsafe Raw APIs (sql-002)
    if (isRuleActive(SQL_QUERY_RULES.UNSAFE_RAW_API)) {
      const unsafeRawMatches = this.findUnsafeRawApis(masked, lines);
      for (const m of unsafeRawMatches) {
        findings.push({
          ruleId: SQL_QUERY_RULES.UNSAFE_RAW_API,
          message: `Unsafe raw query method '${m.method}' called without parameter bindings (${m.snippet}), risking SQL injection.`,
          severity: ruleSeverity(SQL_QUERY_RULES.UNSAFE_RAW_API, Severity.HIGH),
          location: {
            file: filePath,
            startLine: m.line,
            endLine: m.line,
            startColumn: m.column,
          },
          suggestedFix: {
            description:
              "Use safe query methods (such as $queryRaw with template tags) or pass parameterized arguments.",
          },
        });
      }
    }

    // 3. Scan for Dynamic Identifier Interpolation (sql-004)
    if (isRuleActive(SQL_QUERY_RULES.DYNAMIC_IDENTIFIER)) {
      const idMatches = this.findDynamicIdentifiers(masked, lines);
      for (const m of idMatches) {
        findings.push({
          ruleId: SQL_QUERY_RULES.DYNAMIC_IDENTIFIER,
          message: `Dynamic SQL clause interpolation (${m.snippet}) lacks identifier escaping or allowlist validation.`,
          severity: ruleSeverity(
            SQL_QUERY_RULES.DYNAMIC_IDENTIFIER,
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
              "Validate column/table identifiers against an allowlist or quote them using an identifier escaper.",
          },
        });
      }
    }

    // 4. Scan for Concatenated Query with User Input (sql-001)
    if (isRuleActive(SQL_QUERY_RULES.CONCATENATED_QUERY)) {
      const taintSet = this.collectTaint(masked, opts);
      const querySinks = this.findQuerySinks(masked, lines, opts);

      for (const sink of querySinks) {
        if (this.hasSanitizerInProximity(masked, lines, sink.line, opts)) {
          continue;
        }

        const isTainted = this.isArgumentTainted(sink.argText, taintSet);
        const isDynamic =
          sink.argText.includes("+") ||
          (sink.argText.startsWith("`") && sink.argText.includes("${")) ||
          sink.argText.includes("%") ||
          sink.argText.includes(".format(");

        if (isTainted || (isDynamic && this.containsSqlKeywords(sink.argText))) {
          findings.push({
            ruleId: SQL_QUERY_RULES.CONCATENATED_QUERY,
            message: `Raw SQL query constructed using string concatenation or template interpolation: '${sink.argText}' in '${sink.sinkName}'.`,
            severity: ruleSeverity(
              SQL_QUERY_RULES.CONCATENATED_QUERY,
              Severity.CRITICAL,
            ),
            location: {
              file: filePath,
              startLine: sink.line,
              endLine: sink.line,
              startColumn: sink.column,
            },
            suggestedFix: {
              description:
                "Use parameterized queries with bind variables ($1, ?, %s) instead of dynamic string construction.",
            },
          });
        }
      }
    }

    // Sort findings deterministically
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

  private findIncompleteSanitization(
    code: string,
    lines: LineIndex,
  ): Array<{ matched: string; line: number; column: number }> {
    const results: Array<{ matched: string; line: number; column: number }> = [];
    const patterns = [
      /\.replace\s*\(\s*(?:\/'\/g?|['"]'['"])\s*,\s*['"]''['"]\s*\)/g,
      /\.replace\s*\(\s*(?:\/--\/g?|['"]--['"])\s*,\s*['"]\s*['"]\s*\)/g,
    ];

    for (const pat of patterns) {
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

  private findUnsafeRawApis(
    code: string,
    lines: LineIndex,
  ): Array<{ method: string; snippet: string; line: number; column: number }> {
    const results: Array<{
      method: string;
      snippet: string;
      line: number;
      column: number;
    }> = [];

    // Prisma $queryRawUnsafe
    const prismaRe = /\$queryRawUnsafe\s*\(([^)]+)\)/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = prismaRe.exec(code)) !== null) {
      const args = pMatch[1].split(",");
      if (args.length === 1) {
        const pos = lines.position(pMatch.index);
        results.push({
          method: "$queryRawUnsafe",
          snippet: pMatch[0],
          line: pos.line,
          column: pos.column,
        });
      }
    }

    // Python cursor.execute("... %s" % var) or cursor.execute("... {}".format(var))
    const pyExecRe =
      /\bcursor\s*\.\s*execute\s*\(\s*['"].*?%s.*?['"]\s*%\s*[^,)]+\)/g;
    let pyMatch: RegExpExecArray | null;
    while ((pyMatch = pyExecRe.exec(code)) !== null) {
      const pos = lines.position(pyMatch.index);
      results.push({
        method: "cursor.execute",
        snippet: pyMatch[0],
        line: pos.line,
        column: pos.column,
      });
    }

    return results;
  }

  private findDynamicIdentifiers(
    code: string,
    lines: LineIndex,
  ): Array<{ snippet: string; line: number; column: number }> {
    const results: Array<{ snippet: string; line: number; column: number }> = [];
    const idPatterns = [
      /(?:ORDER\s+BY|GROUP\s+BY)\s*['"`]\s*\+\s*[\w$]+/gi,
      /(?:ORDER\s+BY|GROUP\s+BY)\s*\$\{[^}]+\}/gi,
      /\bFROM\s*['"`]\s*\+\s*[\w$]+/gi,
      /\bFROM\s*\$\{[^}]+\}/gi,
    ];

    for (const pat of idPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pat.exec(code)) !== null) {
        const pos = lines.position(match.index);
        results.push({
          snippet: match[0],
          line: pos.line,
          column: pos.column,
        });
      }
    }
    return results;
  }

  private collectTaint(code: string, opts: ResolvedSqlQueryOptions): Set<string> {
    const tainted = new Set<string>();
    const sources = [...BUILTIN_SOURCES];

    for (const src of opts.additionalSources) {
      sources.push({
        kind: "custom",
        re: new RegExp(`\\b${escapeRegExp(src)}\\b`),
      });
    }

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

  private findQuerySinks(
    code: string,
    lines: LineIndex,
    opts: ResolvedSqlQueryOptions,
  ): Array<{ sinkName: string; argText: string; line: number; column: number }> {
    const sinks: Array<{
      sinkName: string;
      argText: string;
      line: number;
      column: number;
    }> = [];

    const sinkDefs = [
      { name: "db.query", re: /\b(?:db|client|pool|connection|sql)\s*\.\s*query\s*\(/g },
      { name: "sqlite.run", re: /\b(?:sqlite3?|db)\s*\.\s*(?:run|all|get|each)\s*\(/g },
      { name: "sequelize.query", re: /\bsequelize\s*\.\s*query\s*\(/g },
      { name: "$queryRawUnsafe", re: /\b\$queryRawUnsafe\s*\(/g },
      { name: "cursor.execute", re: /\b(?:cursor|conn|connection)\s*\.\s*execute\s*\(/g },
    ];

    for (const customSink of opts.additionalSinks) {
      sinkDefs.push({
        name: customSink,
        re: new RegExp(`\\b${escapeRegExp(customSink)}\\s*\\(`, "g"),
      });
    }

    for (const def of sinkDefs) {
      let match: RegExpExecArray | null;
      while ((match = def.re.exec(code)) !== null) {
        const openParen = match.index + match[0].length;
        const callArgs = readCallArgs(code, openParen);
        if (callArgs.args.length > 0) {
          const firstArg = callArgs.args[0].text;
          const pos = lines.position(match.index);
          sinks.push({
            sinkName: def.name,
            argText: firstArg,
            line: pos.line,
            column: pos.column,
          });
        }
      }
    }

    return sinks;
  }

  private hasSanitizerInProximity(
    code: string,
    lines: LineIndex,
    sinkLine: number,
    opts: ResolvedSqlQueryOptions,
  ): boolean {
    const startLine = Math.max(1, sinkLine - opts.proximityLines);
    const endLine = sinkLine;

    const allLines = code.split("\n");
    const window = allLines.slice(startLine - 1, endLine).join("\n");

    for (const san of opts.safeSanitizers) {
      const sanRe = new RegExp(`\\b${escapeRegExp(san)}\\s*\\(`, "i");
      if (sanRe.test(window)) {
        return true;
      }
    }

    return false;
  }

  private isArgumentTainted(arg: string, taintSet: Set<string>): boolean {
    const trimmed = arg.trim();

    // Constant string literals without interpolation or concatenation are safe
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.includes("+")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'") && !trimmed.includes("+"))
    ) {
      return false;
    }

    for (const src of BUILTIN_SOURCES) {
      if (src.re.test(trimmed)) return true;
    }

    for (const t of taintSet) {
      const tRe = new RegExp(`\\b${escapeRegExp(t)}\\b`);
      if (tRe.test(trimmed)) return true;
    }

    if (
      /\b(?:userId|userFilter|queryParam|searchTerm|userInput|filterVal)\b/i.test(
        trimmed,
      )
    ) {
      return true;
    }

    return false;
  }

  private containsSqlKeywords(expr: string): boolean {
    return /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|UNION|FROM|WHERE)\b/i.test(expr);
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
