export interface RuleCoverageEntry {
  ruleId: string;
  ruleName: string;
  category: string;
  executed: boolean;
  findingsCount: number;
  executionTime: number;
  suppressedCount: number;
}

export interface CoverageReport {
  totalRules: number;
  executedRules: number;
  coveragePercentage: number;
  entries: RuleCoverageEntry[];
  byCategory: Record<string, { total: number; executed: number; percentage: number }>;
  summary: string;
}

export interface CoverageConfig {
  minCoverageThreshold: number;
  failOnLowCoverage: boolean;
  categories: string[];
}
