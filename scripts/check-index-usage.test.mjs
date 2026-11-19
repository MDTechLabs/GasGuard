import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findSeqScans } from "./check-index-usage.mjs";

describe("index usage regression check (issue #1235)", () => {
  it("passes an index scan plan", () => {
    const plan = { "Node Type": "Index Scan", "Relation Name": "analysis_results" };
    assert.deepEqual(findSeqScans(plan), []);
  });

  it("flags a nested Seq Scan", () => {
    const plan = {
      "Node Type": "Sort",
      Plans: [{ "Node Type": "Seq Scan", "Relation Name": "analysis_results" }],
    };
    assert.deepEqual(findSeqScans(plan), ["analysis_results"]);
  });
});
