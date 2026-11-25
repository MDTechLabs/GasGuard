import * as fs from 'fs';
import * as path from 'path';

/**
 * Data model compatibility (#1238): the AnalysisResult entity must stay in step with the schema
 * the migrations build, so rows written by an older release still load and new columns never
 * break existing rows. Columns are matched by the snake_case name the migrations use.
 * The files are read as text; no database, TypeORM connection or migration is run.
 */
const DB_DIR = path.join(__dirname, '..');
const TABLE = 'analysis_results';

const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

interface EntityColumn { name: string; nullable: boolean }
interface SchemaColumn { name: string; nullable: boolean; hasDefault: boolean; migration: string }

function entityColumns(text: string): EntityColumn[] {
  const out: EntityColumn[] = [];
  let pending: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const deco = /^\s*@(Column|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|VersionColumn)\((.*)\)\s*$/.exec(line);
    if (deco) {
      pending = deco[2];
      continue;
    }
    const prop = /^\s*([A-Za-z_$][\w$]*)(\?)?\s*:\s*[^;]+;/.exec(line);
    if (prop && pending !== undefined) {
      out.push({ name: prop[1], nullable: /nullable:\s*true/.test(pending) });
      pending = undefined;
    }
  }
  return out;
}

function section(text: string, fn: 'up' | 'down'): string {
  const start = text.search(new RegExp(`async\\s+${fn}\\s*\\(`));
  if (start === -1) return '';
  const end = fn === 'up' ? text.search(/async\s+down\s*\(/) : -1;
  return text.slice(start, end === -1 ? undefined : end);
}

function parseColumn(def: string, migration: string): SchemaColumn | undefined {
  const m = /^\s*"([\w]+)"\s+(.*)$/.exec(def);
  if (!m) return undefined;
  return { name: m[1], nullable: !/NOT NULL/i.test(m[2]), hasDefault: /\bDEFAULT\b/i.test(m[2]), migration };
}

function migrationFiles(): string[] {
  const dir = path.join(DB_DIR, 'migrations');
  return fs.readdirSync(dir).filter((f) => /^\d+-.*\.ts$/.test(f)).sort();
}

function schemaColumns(): SchemaColumn[] {
  const cols = new Map<string, SchemaColumn>();
  for (const file of migrationFiles()) {
    const up = section(fs.readFileSync(path.join(DB_DIR, 'migrations', file), 'utf8'), 'up');
    const create = new RegExp(`CREATE TABLE "${TABLE}"\\s*\\(([\\s\\S]*?)\\)\\s*\`\\s*\\)`).exec(up);
    if (create) {
      for (const line of create[1].split(/,\s*\r?\n/)) {
        const col = parseColumn(line, file);
        if (col) cols.set(col.name, col);
      }
    }
    for (const add of up.matchAll(new RegExp(`ALTER TABLE "${TABLE}" ADD ("[\\w]+"[^\`]*)`, 'g'))) {
      const col = parseColumn(add[1], file);
      if (col) cols.set(col.name, col);
    }
    for (const drop of up.matchAll(new RegExp(`ALTER TABLE "${TABLE}" DROP COLUMN "([\\w]+)"`, 'g'))) cols.delete(drop[1]);
  }
  return [...cols.values()];
}

describe('AnalysisResult data model compatibility (#1238)', () => {
  const entity = entityColumns(fs.readFileSync(path.join(DB_DIR, 'entities', 'analysis-result.entity.ts'), 'utf8'));
  const schema = schemaColumns();
  const bySchemaName = new Map(schema.map((c) => [c.name, c]));

  it('parses both sides (guards against a silently empty comparison)', () => {
    expect(entity.length).toBeGreaterThan(10);
    expect(schema.length).toBeGreaterThan(10);
  });

  it('has a migrated column for every entity column', () => {
    const missing = entity.filter((c) => !bySchemaName.has(snake(c.name))).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it('has an entity column for every migrated column, so no stored data is unreadable', () => {
    const entityNames = new Set(entity.map((c) => snake(c.name)));
    expect(schema.filter((c) => !entityNames.has(c.name)).map((c) => c.name)).toEqual([]);
  });

  it('matches nullability between the entity and the schema', () => {
    const mismatched = entity
      .filter((c) => bySchemaName.has(snake(c.name)) && bySchemaName.get(snake(c.name))!.nullable !== c.nullable)
      .map((c) => c.name);
    expect(mismatched).toEqual([]);
  });

  it('only adds columns that existing rows can satisfy (nullable or with a default)', () => {
    const first = migrationFiles()[0];
    const unsafe = schema.filter((c) => c.migration !== first && !c.nullable && !c.hasDefault).map((c) => `${c.name} (${c.migration})`);
    expect(unsafe).toEqual([]);
  });

  it('reverts every column a later migration adds', () => {
    for (const file of migrationFiles()) {
      const text = fs.readFileSync(path.join(DB_DIR, 'migrations', file), 'utf8');
      const added = [...section(text, 'up').matchAll(new RegExp(`ALTER TABLE "${TABLE}" ADD "([\\w]+)"`, 'g'))].map((m) => m[1]);
      const down = section(text, 'down');
      for (const col of added) expect(down).toMatch(new RegExp(`ALTER TABLE "${TABLE}" DROP COLUMN "${col}"`));
    }
  });

  it('parses a column definition and ignores constraint lines', () => {
    expect(parseColumn('"priority" character varying(50)', 'm')).toMatchObject({ name: 'priority', nullable: true, hasDefault: false });
    expect(parseColumn('"version" integer NOT NULL DEFAULT 1', 'm')).toMatchObject({ nullable: false, hasDefault: true });
    expect(parseColumn('CONSTRAINT "PK_x" PRIMARY KEY ("id")', 'm')).toBeUndefined();
  });
});
