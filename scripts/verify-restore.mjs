#!/usr/bin/env node
/**
 * Issue #1237 – Backup restore integrity validation.
 *
 * Compares per-table row counts and an md5 checksum of all rows between the
 * source database and a restored copy. Exits 1 on any mismatch.
 *
 * Usage:
 *   node scripts/verify-restore.mjs <sourceUrl> <restoredUrl>
 *   RESTORE_TABLES=analysis_results,users node scripts/verify-restore.mjs ...
 * Requires the `psql` client on PATH (no extra npm dependencies).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const DEFAULT_TABLES = ["analysis_results"];

export function compareSummaries(source, restored) {
  const problems = [];
  for (const table of Object.keys(source)) {
    const a = source[table];
    const b = restored[table];
    if (!b) problems.push(`${table}: missing in restored database`);
    else if (a.count !== b.count)
      problems.push(`${table}: row count ${a.count} != ${b.count}`);
    else if (a.checksum !== b.checksum) problems.push(`${table}: checksum mismatch`);
  }
  return problems;
}

function summarize(url, table) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error(`invalid table name: ${table}`);
  const sql = `SELECT count(*), coalesce(md5(string_agg(t::text, '' ORDER BY t::text)), '') FROM "${table}" t`;
  const out = execFileSync("psql", [url, "-At", "-F", "|", "-c", sql], {
    encoding: "utf8",
  }).trim();
  const [count, checksum] = out.split("|");
  return { count: Number(count), checksum };
}

function main() {
  const [sourceUrl, restoredUrl] = process.argv.slice(2);
  if (!sourceUrl || !restoredUrl) {
    console.error("Usage: verify-restore.mjs <sourceUrl> <restoredUrl>");
    process.exit(2);
  }
  const tables = process.env.RESTORE_TABLES
    ? process.env.RESTORE_TABLES.split(",").map((t) => t.trim())
    : DEFAULT_TABLES;
  const source = {};
  const restored = {};
  for (const t of tables) {
    source[t] = summarize(sourceUrl, t);
    try {
      restored[t] = summarize(restoredUrl, t);
    } catch {
      /* reported as missing by compareSummaries */
    }
  }
  const problems = compareSummaries(source, restored);
  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL: ${p}`));
    process.exit(1);
  }
  console.log(`PASS: ${tables.length} table(s) match (row counts and checksums)`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  main();
}
