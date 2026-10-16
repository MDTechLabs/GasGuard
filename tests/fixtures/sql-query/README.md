# SQL Query Construction Analyzer Fixtures

Fixtures demonstrating SQL injection vulnerabilities (CWE-89):
- Unparameterized dynamic query concatenation (`db.query("SELECT ... " + id)`)
- Unsafe raw query APIs without bindings (`$queryRawUnsafe`, `cursor.execute` with `%`)
- Naive sanitization attempts (`replace(/'/g, "''")`)
- Dynamic identifier interpolation in `ORDER BY` clauses
