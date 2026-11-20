#!/usr/bin/env node
/**
 * Issue #1235 – Index usage regression check.
 *
 * Runs EXPLAIN (FORMAT JSON) on key queries with sequential scans disabled
 * for the planner; any remaining "Seq Scan" node means no usable index exists
 * and the check fails.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/check-index-usage.mjs
 * Requires the `psql` client on PATH (no extra npm dependencies).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/** Key queries on analysis_results (see AnalysisResultRepository). */
export const KEY_QUERIES = [
  {
    name: "analysis by merchant",
    sql: "SELECT * FROM analysis_results WHERE \"merchantId\" = 'm'",
  },
  {
    name: "analysis by chain",
    sql: "SELECT * FROM analysis_results WHERE \"chainId\" = 'c'",
  },
  {
    name: "analysis trend by created_at",
    sql: "SELECT * FROM analysis_results WHERE \"createdAt\" >= now() - interval '30 days'",
  },
];

/** Returns the relation names of every Seq Scan node in an EXPLAIN JSON plan. */
export function findSeqScans(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node["Node Type"] === "Seq Scan") found.push(node["Relation Name"]);
  for (const child of node.Plans || []) findSeqScans(child, found);
  return found;
}

function explain(url, sql) {
  const out = execFileSync(
    "psql",
    [url, "-At", "-c", "SET enable_seqscan = off", "-c", `EXPLAIN (FORMAT JSON) ${sql}`],
    { encoding: "utf8" },
  );
  const json = out.slice(out.indexOf("["));
  return JSON.parse(json)[0].Plan;
}

function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  let failed = 0;
  for (const q of KEY_QUERIES) {
    const scans = findSeqScans(explain(url, q.sql));
    if (scans.length) {
      failed++;
      console.error(`FAIL: ${q.name} uses Seq Scan on ${scans.join(", ")}`);
    } else {
      console.log(`PASS: ${q.name}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  main();
}
