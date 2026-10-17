# Unsafe Deserialization Analysis (CWE-502)

GasGuard's `UnsafeDeserializationAnalyzer` scans codebases for insecure deserialization vulnerabilities ([CWE-502](https://cwe.mitre.org/data/definitions/502.html)). Deserializing untrusted data without strict validation allows remote attackers to execute arbitrary code, bypass authentication, or cause denial of service.

| Layer | Location |
| --- | --- |
| Analyzer (engine) | `libs/engine/analyzers/unsafe-deserialization/` |
| Worker job + persistence | `apps/api/src/scanner/deserialization-scan.job.ts` |
| Fixtures (representative repos) | `tests/fixtures/unsafe-deserialization/` |

## Rules

| Rule | Name | Default severity | Description |
| --- | --- | --- | --- |
| `deserialization-001` | Unsafe Object Deserialization | `critical` | Detects calls to libraries known to instantiate executable code during deserialization (e.g. `node-serialize.unserialize`, `serialize-to-js.deserialize`, `funcster`). |
| `deserialization-002` | Unsafe YAML Deserialization | `high` | Detects `yaml.unsafeLoad`, `yaml.unsafe_load`, or YAML parsers configured with permissive schemas (e.g. `DEFAULT_SCHEMA`) that allow custom type and function execution. |
| `deserialization-003` | Eval-Based Deserialization | `critical` | Detects dynamic evaluation (`eval("(" + data + ")")`, `new Function("return " + data)()`) used in place of safe JSON parsing. |
| `deserialization-004` | Dangerous Deserialization Options | `high` | Detects options that re-enable code execution or prototype instantiation during parsing (e.g. BSON `evalFunctions: true`). |
| `deserialization-005` | Unsafe Python/Native Deserialization | `critical` | Detects `pickle.loads`, `_pickle.loads`, `cPickle.loads`, and unconstrained `marshal` or `shelve` calls on untrusted byte streams. |

## Configuration

Options are configured under `AnalyzerConfig.options.unsafeDeserialization`. Every option is optional:

```jsonc
{
  "rules": {
    "deserialization-001": true,
    "deserialization-002": { "enabled": true, "severity": "critical" }
  },
  "options": {
    "unsafeDeserialization": {
      "safeParsers": ["myCustomValidator.safeParse"],
      "additionalSinks": ["customParser.dangerDeserialize"],
      "maxFileBytes": 1048576,
      "proximityLines": 10
    }
  }
}
```

### Safe Remediation Patterns

- **JSON**: Replace `node-serialize` or `eval` with standard `JSON.parse()` combined with schema validation (e.g. `zod`, `valibot`).
- **YAML**: Replace `yaml.unsafeLoad()` with `yaml.safeLoad()` or specify `schema: yaml.FAILSAFE_SCHEMA` / `yaml.JSON_SCHEMA`. In Python, use `yaml.safe_load(data)` or `yaml.load(data, Loader=yaml.SafeLoader)`.
- **Python**: Avoid `pickle` for untrusted payloads; use JSON or signed HMAC tokens with `itsdangerous` or `cryptography`.

## Failure Semantics & Tenant Isolation

1. **Deterministic Execution**: Given the same file content and configuration, analysis output is strictly deterministic.
2. **Tenant Scoping**: The worker job enforces complete tenant isolation across `organizationId`, `repositoryId`, and `analysisJobId`.
3. **Idempotence**: Retrying a scan job deduplicates against previously persisted findings by unique composite key (`ruleId`, `filePath`, `line`, `title`).
4. **Data Privacy**: Telemetry, logs, and error messages record only file paths, line counts, and durations—never source code or sensitive payload values.
