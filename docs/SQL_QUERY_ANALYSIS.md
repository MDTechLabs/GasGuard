# SQL Query Construction Analysis

GasGuard's `SqlQueryAnalyzer` detects SQL Injection vulnerabilities
([CWE-89](https://cwe.mitre.org/data/definitions/89.html)) in Node.js / TypeScript
and Python services. These vulnerabilities stem from dynamically building SQL statements
via string concatenation or template literals rather than using parameterized query placeholders.

| Layer | Location |
| --- | --- |
| Analyzer (engine) | `libs/engine/analyzers/sql-query/` |
| Worker job + persistence | `apps/api/src/scanner/sql-query-scan.job.ts` |
| Fixtures (representative repos) | `tests/fixtures/sql-query/` |

## Rules

| Rule | Default severity | Detects |
| --- | --- | --- |
| `sql-001` SQL query constructed with unescaped user input (SQL Injection) | critical | Raw database queries (`db.query`, `client.query`, `sqlite.run`, `cursor.execute`) constructed by string concatenation or template literal interpolation with user input. |
| `sql-002` Unsafe raw database query API called without parameter bindings | high | Unsafe raw query APIs (e.g. Prisma `$queryRawUnsafe` or Python `cursor.execute("... %s" % val)`) called without parameter bindings. |
| `sql-003` Incomplete SQL sanitization allows SQL injection bypass | medium | Naive substring replacements (e.g. `.replace(/'/g, "''")` or stripping `--`) which can be bypassed by comments, backslashes, or alternate encodings. |
| `sql-004` Unquoted dynamic identifier in SQL query | high | Dynamic table or column interpolation (e.g. in `ORDER BY`, `GROUP BY`, or `FROM` clauses) without identifier quoting or allowlist validation. |

## Remediation Guidelines

1. **Use Parameterized Queries**:
   Pass query parameters separately to let the database driver safely bind values:
   ```typescript
   // Safe: parameterized placeholder
   await db.query("SELECT * FROM users WHERE id = $1", [userId]);
   ```
2. **Safe Prisma Raw Queries**:
   Use tagged template `$queryRaw` instead of `$queryRawUnsafe`:
   ```typescript
   // Safe
   await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userId}`;
   ```
3. **Dynamic Identifiers**:
   Allowlist valid columns or use an identifier escaping helper:
   ```typescript
   const ALLOWED_SORT = new Set(["name", "date"]);
   if (!ALLOWED_SORT.has(sortCol)) throw new Error("Invalid column");
   ```

## Configuration Options

Configure options under `AnalyzerConfig.options.sqlQuery`:
```json
{
  "options": {
    "sqlQuery": {
      "safeSanitizers": ["escapeIdentifier"],
      "additionalSinks": ["myDb.executeRaw"],
      "additionalSources": ["event.queryStringParameters.id"]
    }
  }
}
```
