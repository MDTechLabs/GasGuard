/**
 * Issue #905 — Soroban Profile Reporting Types
 *
 * Types and options for generating multi-format reports (Markdown, JSON, HTML, Text)
 * from Soroban Entry-Point Resource Profiler results.
 */

import { CostTier, EntryPointProfileReport } from '../../analyzers/soroban/entrypoints/profile/types';

export type ProfileReportFormat = 'markdown' | 'json' | 'html' | 'text';

export interface ProfileReportOptions {
  /** Output format (default: 'markdown') */
  format?: ProfileReportFormat;
  /** Optional project or repository name */
  projectName?: string;
  /** Optional target file path to persist the report */
  outputPath?: string;
  /** Include optimization recommendations (default: true) */
  includeRecommendations?: boolean;
  /** Include detailed per-entry-point breakdown (default: true) */
  includeDetailedBreakdown?: boolean;
  /** Include resource hotspot sections (default: true) */
  includeHotspots?: boolean;
  /** Limit number of ranked entry points displayed (default: all) */
  topExpensiveLimit?: number;
  /** Minimum cost tier to include in details (e.g. 'critical' | 'high' | 'medium' | 'low') */
  minCostTier?: CostTier;
  /** Show visual score bars / legend (default: true) */
  showLegend?: boolean;
}

export interface FormattedReportSummary {
  contractName: string;
  totalEntryPoints: number;
  averageCost: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  mostExpensiveName?: string;
  mostExpensiveCost?: number;
}
