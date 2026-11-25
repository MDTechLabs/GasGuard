# Migration Safety Checks (Issue #995)

## Purpose

Protect production databases from irreversible schema changes landing without review.

## CI enforcement

The job **Migration Safety** in `.github/workflows/migration-safety.yml` runs:

```bash
node scripts/check-migrations.mjs
```

It scans TypeORM migration sources under `apps/api-service/src/database/migrations` for destructive patterns:

| Pattern | Severity |
|---------|----------|
| `DROP TABLE` / `dropTable(` | critical |
| `DROP COLUMN` / `dropColumn(` | critical |
| `TRUNCATE` | critical |
| `DELETE FROM …;` (no WHERE) | high |
| `CASCADE`, column renames, type changes | warning |

### Explicit approval override

Destructive migrations are blocked unless:

```bash
ALLOW_DESTRUCTIVE_MIGRATIONS=true
```

is set in the CI job environment **after** documented approval (change ticket / on-call sign-off). Never bake this flag into default CI.

## Rollback limits

| Change type | Rollback feasible? | Notes |
|-------------|--------------------|-------|
| Additive (`CREATE TABLE`, new nullable column) | Yes | Deploy previous app revision; optional down migration |
| Backfill + NOT NULL | Limited | Requires data restore or multi-step expand/contract |
| `DROP COLUMN` / `DROP TABLE` | **No** without backup | Must restore from backup; RPO applies (see DATABASE_BACKUP_RESTORE.md) |
| Type narrowing | Rarely | May need restore |

**Policy:** Prefer expand/contract migrations. Never drop columns in the same release that removes application reads of those columns.

## Local usage

```bash
node scripts/check-migrations.mjs
node --test scripts/check-migrations.test.mjs
```

## Data model compatibility tests

`apps/api-service/src/database/__tests__/analysis-result-compatibility.spec.ts` reads the `AnalysisResult` entity and the migrations as text (no database is used) and fails when:

- an entity column has no migrated column, or a migrated column has no entity column (matched by snake_case name);
- nullability differs between the entity and the schema;
- a migration after the initial one adds a `NOT NULL` column without a `DEFAULT`, which would break existing rows;
- a migration's `down()` does not drop a column its `up()` added.

The entity uses camelCase properties and the migrations use snake_case columns, so they only line up at runtime under a snake_case naming strategy. The database module does not configure one today; this test checks the names after that mapping and does not check the runtime configuration.

## Security / operational notes

- Migration runners must use least-privilege DB roles (DDL-capable only in migrate jobs, not the app runtime role).
- Do not embed credentials in migration files or CI logs.
