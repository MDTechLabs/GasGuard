/**
 * Rule: soroban-redundant-footprint (#893)
 * Detects duplicate or unnecessary entries in analyzed transaction footprints.
 */

import {
  analyzeFootprint,
  analyzeFootprintObject,
  FootprintAnalysisReport,
  RedundantFootprintFinding,
} from "../../../analyzers/soroban/footprint/footprint-analyzer";

export interface FootprintRuleFinding {
  ruleId: "soroban-redundant-footprint";
  line: number;
  message: string;
  suggestion: string;
  severity: "high" | "medium" | "low" | "info";
  patternId: string;
  entry?: {
    key: string;
    accessType: string;
    isDuplicate: boolean;
  };
}

export interface FootprintRuleReport {
  findings: FootprintRuleFinding[];
  summary: string;
  metrics: {
    totalEntries: number;
    duplicateEntries: number;
    unusedEntries: number;
    readOnlyEntries: number;
    readWriteEntries: number;
  };
}

/**
 * Detect redundant footprint entries in Soroban source code.
 */
export function detectRedundantFootprintEntries(
  source: string,
): FootprintRuleReport {
  const analysis = analyzeFootprint(source);
  return convertToRuleReport(analysis);
}

/**
 * Detect redundant footprint entries in a footprint object.
 */
export function detectRedundantFootprintInObject(footprint: {
  readOnly: string[];
  readWrite: string[];
}): FootprintRuleReport {
  const analysis = analyzeFootprintObject(footprint);
  return convertToRuleReport(analysis);
}

/**
 * Convert analysis report to rule report format.
 */
function convertToRuleReport(
  analysis: FootprintAnalysisReport,
): FootprintRuleReport {
  const findings: FootprintRuleFinding[] = analysis.findings.map((finding) => ({
    ruleId: "soroban-redundant-footprint" as const,
    line: finding.line,
    message: finding.message,
    suggestion: finding.suggestion,
    severity: finding.severity,
    patternId: finding.patternId,
    entry: finding.entry
      ? {
          key: finding.entry.key,
          accessType: finding.entry.accessType,
          isDuplicate: finding.entry.isDuplicate,
        }
      : undefined,
  }));

  return {
    findings,
    summary: analysis.summary,
    metrics: analysis.metrics,
  };
}
