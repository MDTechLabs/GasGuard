import {
  Analyzer,
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
  isSupportedDeserializationFile,
  resolveUnsafeDeserializationOptions,
  ResolvedUnsafeDeserializationOptions,
  UNSAFE_DESERIALIZATION_OPTIONS_KEY,
  UnsafeDeserializationOptions,
  validateUnsafeDeserializationOptions,
} from "./config";
import {
  escapeRegExp,
  LineIndex,
  maskComments,
  readCallArgs,
} from "./lexer";
import {
  DeserializationAnalysisObserver,
  DeserializationSkipReason,
  notifySafely,
} from "./telemetry";

export const UNSAFE_DESERIALIZATION_RULES = {
  NODE_SERIALIZE: "deserialization-001",
  UNSAFE_YAML: "deserialization-002",
  EVAL_DESERIALIZATION: "deserialization-003",
  DANGEROUS_DESERIALIZATION_OPTIONS: "deserialization-004",
  PYTHON_PICKLE: "deserialization-005",
} as const;

export interface UnsafeDeserializationAnalyzerOptions {
  config?: AnalyzerConfig;
  observer?: DeserializationAnalysisObserver;
}

const BUILTIN_RULES: Rule[] = [
  {
    id: UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE,
    name: "Unsafe Object Deserialization",
    description:
      "Detects unsafe JavaScript object deserialization (e.g. node-serialize, serialize-to-js, funcster) vulnerable to remote code execution.",
    severity: Severity.CRITICAL,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-502", "rce"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/502.html",
  },
  {
    id: UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML,
    name: "Unsafe YAML Deserialization",
    description:
      "Detects unsafe YAML loading functions or schemas that allow instantiation of arbitrary objects and functions.",
    severity: Severity.HIGH,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-502", "yaml"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/502.html",
  },
  {
    id: UNSAFE_DESERIALIZATION_RULES.EVAL_DESERIALIZATION,
    name: "Eval-Based Deserialization",
    description:
      "Detects dynamic code evaluation (eval / new Function) used for deserializing untrusted serialized object strings.",
    severity: Severity.CRITICAL,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-502", "cwe-95", "eval"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/502.html",
  },
  {
    id: UNSAFE_DESERIALIZATION_RULES.DANGEROUS_DESERIALIZATION_OPTIONS,
    name: "Dangerous Deserialization Options",
    description:
      "Detects deserialization configurations that enable executable functions or unsafe prototype instantiation (e.g. BSON evalFunctions: true).",
    severity: Severity.HIGH,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-502", "options"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/502.html",
  },
  {
    id: UNSAFE_DESERIALIZATION_RULES.PYTHON_PICKLE,
    name: "Unsafe Python/Native Object Deserialization",
    description:
      "Detects unsafe deserialization of native Python objects using pickle, marshal, or unconstrained YAML loaders.",
    severity: Severity.CRITICAL,
    category: "security",
    enabled: true,
    tags: ["security", "cwe-502", "pickle"],
    documentationUrl: "https://cwe.mitre.org/data/definitions/502.html",
  },
];

export class UnsafeDeserializationAnalyzer extends BaseAnalyzer implements Analyzer {
  public static readonly NAME = "UnsafeDeserializationAnalyzer";
  public static readonly VERSION = "1.0.0";

  private readonly observer?: DeserializationAnalysisObserver;

  constructor(options: UnsafeDeserializationAnalyzerOptions = {}) {
    super();
    this.observer = options.observer;
    if (options.config) this.config = options.config;
  }

  getName(): string {
    return UnsafeDeserializationAnalyzer.NAME;
  }

  getVersion(): string {
    return UnsafeDeserializationAnalyzer.VERSION;
  }

  supportsLanguage(language: Language | string): boolean {
    return (
      language === Language.JAVASCRIPT ||
      language === Language.TYPESCRIPT ||
      language === "js" ||
      language === "ts" ||
      language === "py" ||
      language === "python"
    );
  }

  getSupportedLanguages(): Language[] {
    return [Language.JAVASCRIPT, Language.TYPESCRIPT];
  }

  getRules(): Rule[] {
    return BUILTIN_RULES.map((r) => ({ ...r, tags: r.tags ? [...r.tags] : undefined }));
  }

  getRule(ruleId: string): Rule | undefined {
    return BUILTIN_RULES.find((r) => r.id === ruleId);
  }

  getCapabilities(): AnalyzerCapabilities {
    return {
      ...super.getCapabilities(),
      securityAnalysis: true,
      cwe: ["CWE-502"],
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
      } else if (typeof rc === "object" && rc.severity !== undefined && !severities.has(rc.severity)) {
        errors.push(`Rule ${ruleId} has unknown severity: ${String(rc.severity)}`);
      }
    }
    if (
      config.maxFindings !== undefined &&
      (!Number.isInteger(config.maxFindings) || config.maxFindings < 0)
    ) {
      errors.push("maxFindings must be a non-negative integer");
    }
    errors.push(...validateUnsafeDeserializationOptions(config.options?.[UNSAFE_DESERIALIZATION_OPTIONS_KEY]));
    return errors;
  }

  async analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const effectiveConfig = config ?? this.config ?? {};
    const rawOptions = effectiveConfig.options?.[UNSAFE_DESERIALIZATION_OPTIONS_KEY];

    const configErrors = validateUnsafeDeserializationOptions(rawOptions);
    if (configErrors.length > 0) {
      this.notifySkipped(filePath, "invalid-input");
      return this.buildResult([], 0, startTime, [
        {
          file: filePath,
          message: `Invalid unsafeDeserialization options: ${configErrors.join("; ")}`,
        },
      ]);
    }

    const options = resolveUnsafeDeserializationOptions(rawOptions);

    if (code.includes("\0")) {
      this.notifySkipped(filePath, "binary-content");
      return this.buildResult([], 0, startTime);
    }

    if (isDeclarationFile(filePath)) {
      this.notifySkipped(filePath, "declaration-file");
      return this.buildResult([], 0, startTime);
    }

    if (!isSupportedDeserializationFile(filePath)) {
      this.notifySkipped(filePath, "unsupported-file-type");
      return this.buildResult([], 0, startTime);
    }

    const codeBytes = Buffer.byteLength(code, "utf8");
    if (codeBytes > options.maxFileBytes) {
      this.notifySkipped(filePath, "file-too-large");
      return this.buildResult([], 0, startTime, [
        {
          file: filePath,
          message: `File size ${codeBytes} bytes exceeds maximum ${options.maxFileBytes} bytes`,
        },
      ]);
    }

    if (this.isPathExcluded(filePath, effectiveConfig)) {
      this.notifySkipped(filePath, "excluded-by-config");
      return this.buildResult([], 0, startTime);
    }

    const isPython = fileExtension(filePath) === ".py";
    const maskedCode = maskComments(code, isPython);
    const lineIndex = new LineIndex(code);

    const findings: Finding[] = [];

    // Run rule scanners
    if (this.isRuleEnabled(UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE, effectiveConfig)) {
      this.scanNodeSerialize(code, maskedCode, filePath, lineIndex, options, effectiveConfig, findings);
    }

    if (this.isRuleEnabled(UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML, effectiveConfig)) {
      this.scanYaml(code, maskedCode, filePath, lineIndex, options, effectiveConfig, findings, isPython);
    }

    if (this.isRuleEnabled(UNSAFE_DESERIALIZATION_RULES.EVAL_DESERIALIZATION, effectiveConfig)) {
      this.scanEvalDeserialization(code, maskedCode, filePath, lineIndex, options, effectiveConfig, findings);
    }

    if (this.isRuleEnabled(UNSAFE_DESERIALIZATION_RULES.DANGEROUS_DESERIALIZATION_OPTIONS, effectiveConfig)) {
      this.scanDangerousOptions(code, maskedCode, filePath, lineIndex, options, effectiveConfig, findings);
    }

    if (isPython && this.isRuleEnabled(UNSAFE_DESERIALIZATION_RULES.PYTHON_PICKLE, effectiveConfig)) {
      this.scanPythonPickle(code, maskedCode, filePath, lineIndex, options, effectiveConfig, findings);
    }

    // Include custom sinks if provided in options
    if (options.additionalSinks.length > 0) {
      this.scanAdditionalSinks(code, maskedCode, filePath, lineIndex, options, effectiveConfig, findings);
    }

    const sortedFindings = sortFindings(findings);
    const limitedFindings =
      effectiveConfig.maxFindings !== undefined && effectiveConfig.maxFindings > 0
        ? sortedFindings.slice(0, effectiveConfig.maxFindings)
        : sortedFindings;

    const findingsByRule: Record<string, number> = {};
    for (const f of limitedFindings) {
      findingsByRule[f.ruleId] = (findingsByRule[f.ruleId] ?? 0) + 1;
    }

    notifySafely(() => {
      this.observer?.onFileAnalyzed?.({
        file: filePath,
        durationMs: Date.now() - startTime,
        findingsByRule,
      });
    });

    return this.buildResult(limitedFindings, 1, startTime);
  }

  private scanNodeSerialize(
    original: string,
    masked: string,
    filePath: string,
    lineIndex: LineIndex,
    options: ResolvedUnsafeDeserializationOptions,
    config: AnalyzerConfig,
    out: Finding[],
  ): void {
    // Detect danger packages: node-serialize, serialize-to-js, funcster, cryo
    const dangerPkgImportRe = /(?:require\s*\(\s*['"](node-serialize|serialize-to-js|funcster|cryo)['"]\s*\)|from\s*['"](node-serialize|serialize-to-js|funcster|cryo)['"])/g;
    let match: RegExpExecArray | null;
    const importedIdentifiers = new Set<string>();

    while ((match = dangerPkgImportRe.exec(masked)) !== null) {
      const pkg = match[1] ?? match[2];
      // Try to find the local binding identifier
      const preLine = masked.slice(Math.max(0, match.index - 80), match.index);
      const varMatch = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*$/.exec(preLine);
      const importMatch = /import\s+([A-Za-z0-9_$]+|\*\s+as\s+[A-Za-z0-9_$]+)\s+from\s*$/.exec(preLine);
      if (varMatch) {
        importedIdentifiers.add(varMatch[1]);
      } else if (importMatch) {
        const id = importMatch[1].replace(/^\*\s+as\s+/, "").trim();
        importedIdentifiers.add(id);
      } else {
        importedIdentifiers.add(pkg.replace(/[^a-zA-Z0-9_$]/g, "_"));
      }
    }

    // Call patterns: serialize.unserialize(...), unserialize(...), funcster.deserialize(...)
    const callPatterns = [
      /\b([A-Za-z0-9_$]+)\s*\.\s*(?:unserialize|unserializeSync)\s*\(/g,
      /\b([A-Za-z0-9_$]+)\s*\.\s*deserialize\s*\(/g,
      /(?<!\.)\bunserialize\s*\(/g,
    ];

    for (const pattern of callPatterns) {
      while ((match = pattern.exec(masked)) !== null) {
        const id = match[1];
        // If an identifier is involved, check if it matches an imported package or standard dangerous names
        const isDangerousCaller =
          !id ||
          importedIdentifiers.has(id) ||
          /^(?:nodeSerialize|serialize|serializeToJs|funcster|cryo|unserializer)$/i.test(id);

        if (!isDangerousCaller) continue;

        const callOffset = match.index;
        const pos = lineIndex.position(callOffset);

        out.push(
          this.createFinding(
            UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE,
            `Unsafe deserialization via '${match[0].slice(0, -1).trim()}' allows arbitrary object and code execution (RCE).`,
            pos.line,
            pos.column,
            pos.column + match[0].length - 1,
            filePath,
            config,
            {
              sink: match[0].slice(0, -1).trim(),
              package: id ?? "node-serialize",
              cwe: "CWE-502",
            },
            "Use safe JSON.parse or strict schema validation rather than dynamic object deserialization.",
          ),
        );
      }
    }
  }

  private scanYaml(
    original: string,
    masked: string,
    filePath: string,
    lineIndex: LineIndex,
    options: ResolvedUnsafeDeserializationOptions,
    config: AnalyzerConfig,
    out: Finding[],
    isPython: boolean,
  ): void {
    // 1. Explicit unsafeLoad / unsafe_load
    const unsafeLoadRe = /\b(?:[A-Za-z0-9_$]+\s*\.\s*)?(?:unsafeLoad|unsafe_load)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = unsafeLoadRe.exec(masked)) !== null) {
      const pos = lineIndex.position(match.index);
      out.push(
        this.createFinding(
          UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML,
          `Unsafe YAML parsing via '${match[0].slice(0, -1).trim()}' can execute arbitrary code.`,
          pos.line,
          pos.column,
          pos.column + match[0].length - 1,
          filePath,
          config,
          { method: match[0].slice(0, -1).trim(), cwe: "CWE-502" },
          "Use yaml.safeLoad, yaml.load with SafeLoader, or schema: FAILSAFE_SCHEMA/JSON_SCHEMA.",
        ),
      );
    }

    // 2. Python yaml.load without Loader or with Loader=yaml.Loader / CLoader
    if (isPython) {
      const pyYamlLoadRe = /\byaml\s*\.\s*load\s*\(/g;
      while ((match = pyYamlLoadRe.exec(masked)) !== null) {
        const argData = readCallArgs(masked, match.index + match[0].length);
        const argsText = argData.args.map(a => a.text).join(", ");
        const hasSafeLoader = /Loader\s*=\s*(?:yaml\s*\.\s*)?(?:SafeLoader|CSafeLoader|BaseLoader)/i.test(argsText);
        if (!hasSafeLoader) {
          const pos = lineIndex.position(match.index);
          out.push(
            this.createFinding(
              UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML,
              "Python yaml.load called without SafeLoader allows arbitrary code execution during deserialization.",
              pos.line,
              pos.column,
              pos.column + match[0].length - 1,
              filePath,
              config,
              { method: "yaml.load", cwe: "CWE-502" },
              "Pass Loader=yaml.SafeLoader or use yaml.safe_load().",
            ),
          );
        }
      }
    } else {
      // 3. JS/TS js-yaml: yaml.load(data, { schema: DEFAULT_SCHEMA }) or unsafe schema option
      const jsYamlLoadRe = /\b(?:yaml|jsYaml)\s*\.\s*load\s*\(/g;
      while ((match = jsYamlLoadRe.exec(masked)) !== null) {
        const argData = readCallArgs(masked, match.index + match[0].length);
        if (argData.args.length >= 2) {
          const optionsArg = argData.args[1].text;
          if (/(?:DEFAULT_SCHEMA|FULL_SCHEMA|customType|allowFunctions\s*:\s*true)/i.test(optionsArg)) {
            const pos = lineIndex.position(match.index);
            out.push(
              this.createFinding(
                UNSAFE_DESERIALIZATION_RULES.UNSAFE_YAML,
                "YAML load specifies an unsafe schema or function execution option.",
                pos.line,
                pos.column,
                pos.column + match[0].length - 1,
                filePath,
                config,
                { method: "yaml.load", cwe: "CWE-502" },
                "Use yaml.load with FAILSAFE_SCHEMA or JSON_SCHEMA, or use yaml.safeLoad.",
              ),
            );
          }
        }
      }
    }
  }

  private scanEvalDeserialization(
    original: string,
    masked: string,
    filePath: string,
    lineIndex: LineIndex,
    options: ResolvedUnsafeDeserializationOptions,
    config: AnalyzerConfig,
    out: Finding[],
  ): void {
    // Matches eval("(" + data + ")") or eval(jsonString) or Function("return " + data)()
    const evalPatterns = [
      /\beval\s*\(\s*['"`]\s*\(?\s*['"`]\s*\+/g,
      /(?:\bnew\s+)?\bFunction\s*\(\s*['"`]return\s+['"`]\s*\+/g,
      /\beval\s*\(\s*(?:req|request|ctx|event|data|payload|body|rawBody|serialized)\b[^\)]*\)/g,
    ];

    const seenOffsets = new Set<number>();

    for (const pattern of evalPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(masked)) !== null) {
        if (seenOffsets.has(match.index)) continue;
        seenOffsets.add(match.index);
        const pos = lineIndex.position(match.index);
        out.push(
          this.createFinding(
            UNSAFE_DESERIALIZATION_RULES.EVAL_DESERIALIZATION,
            `Dynamic evaluation used for deserializing object data via '${match[0].slice(0, 30)}...'`,
            pos.line,
            pos.column,
            pos.column + Math.min(match[0].length, 40),
            filePath,
            config,
            { sink: "eval-deserialization", cwe: "CWE-502" },
            "Replace dynamic eval execution with standard JSON.parse() or a validated parser.",
          ),
        );
      }
    }
  }

  private scanDangerousOptions(
    original: string,
    masked: string,
    filePath: string,
    lineIndex: LineIndex,
    options: ResolvedUnsafeDeserializationOptions,
    config: AnalyzerConfig,
    out: Finding[],
  ): void {
    // Detect BSON evalFunctions: true, promoteBuffers: false, etc.
    const dangerousOptionsRe = /\b(?:evalFunctions\s*:\s*true|allowFunctions\s*:\s*true)\b/g;
    let match: RegExpExecArray | null;

    while ((match = dangerousOptionsRe.exec(masked)) !== null) {
      const pos = lineIndex.position(match.index);
      out.push(
        this.createFinding(
          UNSAFE_DESERIALIZATION_RULES.DANGEROUS_DESERIALIZATION_OPTIONS,
          `Dangerous deserialization option '${match[0]}' enables execution of serialized functions.`,
          pos.line,
          pos.column,
          pos.column + match[0].length - 1,
          filePath,
          config,
          { option: match[0], cwe: "CWE-502" },
          "Disable evalFunctions and allowFunctions in deserialization options.",
        ),
      );
    }
  }

  private scanPythonPickle(
    original: string,
    masked: string,
    filePath: string,
    lineIndex: LineIndex,
    options: ResolvedUnsafeDeserializationOptions,
    config: AnalyzerConfig,
    out: Finding[],
  ): void {
    const pickleRe = /\b(?:pickle|_pickle|cPickle|marshal|shelve)\s*\.\s*(?:loads?|open)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = pickleRe.exec(masked)) !== null) {
      const pos = lineIndex.position(match.index);
      out.push(
        this.createFinding(
          UNSAFE_DESERIALIZATION_RULES.PYTHON_PICKLE,
          `Unsafe Python deserialization via '${match[0].slice(0, -1).trim()}' allows arbitrary code execution.`,
          pos.line,
          pos.column,
          pos.column + match[0].length - 1,
          filePath,
          config,
          { method: match[0].slice(0, -1).trim(), cwe: "CWE-502" },
          "Use safe formats such as JSON (json.loads), Protocol Buffers, or HMAC-authenticated payloads.",
        ),
      );
    }
  }

  private scanAdditionalSinks(
    original: string,
    masked: string,
    filePath: string,
    lineIndex: LineIndex,
    options: ResolvedUnsafeDeserializationOptions,
    config: AnalyzerConfig,
    out: Finding[],
  ): void {
    for (const sink of options.additionalSinks) {
      const escaped = escapeRegExp(sink);
      const re = new RegExp(`\\b${escaped}\\s*\\(`, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(masked)) !== null) {
        const pos = lineIndex.position(match.index);
        out.push(
          this.createFinding(
            UNSAFE_DESERIALIZATION_RULES.NODE_SERIALIZE,
            `Invocation of custom deserialization sink '${sink}'.`,
            pos.line,
            pos.column,
            pos.column + sink.length,
            filePath,
            config,
            { sink, custom: true, cwe: "CWE-502" },
            "Ensure the deserializer rejects untrusted object graphs and executable code.",
          ),
        );
      }
    }
  }

  private isPathExcluded(filePath: string, config: AnalyzerConfig): boolean {
    if (!config.excludePaths || config.excludePaths.length === 0) return false;
    const normalized = filePath.replace(/\\/g, "/");
    for (const pattern of config.excludePaths) {
      if (pattern.includes("**")) {
        const segment = pattern.replace(/\*\*/g, "").replace(/\*/g, "");
        if (normalized.includes(segment)) return true;
      } else if (normalized.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  private isRuleEnabled(ruleId: string, config: AnalyzerConfig): boolean {
    const ruleConfig = config.rules?.[ruleId];
    if (ruleConfig === undefined) return true;
    if (typeof ruleConfig === "boolean") return ruleConfig;
    return ruleConfig.enabled;
  }

  private createFinding(
    ruleId: string,
    message: string,
    line: number,
    startColumn: number,
    endColumn: number,
    filePath: string,
    config: AnalyzerConfig,
    metadata?: Record<string, any>,
    fixDescription?: string,
  ): Finding {
    const builtinRule = BUILTIN_RULES.find((r) => r.id === ruleId);
    let severity = builtinRule?.severity ?? Severity.HIGH;

    const ruleOverride = config.rules?.[ruleId];
    if (typeof ruleOverride === "object" && ruleOverride?.severity) {
      severity = ruleOverride.severity;
    }

    return {
      ruleId,
      message,
      severity,
      location: {
        file: filePath,
        startLine: line,
        endLine: line,
        startColumn,
        endColumn,
      },
      metadata: {
        ...metadata,
        cwe: metadata?.cwe ?? "CWE-502",
      },
      suggestedFix: fixDescription
        ? {
            description: fixDescription,
          }
        : undefined,
    };
  }

  private notifySkipped(file: string, reason: DeserializationSkipReason): void {
    notifySafely(() => {
      this.observer?.onFileSkipped?.({ file, reason });
    });
  }

  private buildResult(
    findings: Finding[],
    filesAnalyzed: number,
    startTime: number,
    errors?: Array<{ file: string; message: string; error?: Error }>,
  ): AnalysisResult {
    const summary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const f of findings) {
      if (f.severity in summary) {
        summary[f.severity as keyof typeof summary]++;
      }
    }

    return {
      findings,
      filesAnalyzed,
      analysisTime: Date.now() - startTime,
      analyzerVersion: this.getVersion(),
      summary,
      errors: errors && errors.length > 0 ? errors : undefined,
    };
  }
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.location.file !== b.location.file) {
      return a.location.file.localeCompare(b.location.file);
    }
    if (a.location.startLine !== b.location.startLine) {
      return a.location.startLine - b.location.startLine;
    }
    const aCol = a.location.startColumn ?? 0;
    const bCol = b.location.startColumn ?? 0;
    if (aCol !== bCol) {
      return aCol - bCol;
    }
    return a.ruleId.localeCompare(b.ruleId);
  });
}
