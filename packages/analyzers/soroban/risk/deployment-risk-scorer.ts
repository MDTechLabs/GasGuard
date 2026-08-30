/**
 * SorobanDeploymentRiskScorer
 *
 * Aggregates normalized findings from security, resource, and deployment
 * analyzers into a single weighted risk score (0–100) with full explainability.
 *
 * Design goals
 * ─────────────
 *  • Category-weighted: security findings outweigh optimization hints by default.
 *  • Configurable: every weight and multiplier can be overridden at construction time.
 *  • Explainable: the output includes a plain-English explanation of every
 *    factor that influenced the score.
 *  • Standalone: no NestJS dependency — pure TypeScript class, easy to unit-test.
 */

import {
  NormalizedFinding,
  DeploymentRiskScore,
  DeploymentRiskWeights,
  SeverityMultipliers,
  CategoryScoreBreakdown,
  FindingCategory,
  RiskLevel,
  RiskGrade,
  DEFAULT_WEIGHTS,
  DEFAULT_SEVERITY_MULTIPLIERS,
} from './types';

// Maximum raw-point total used to normalise to 0–100.
// Represents a contract with ~5 critical security + 5 critical deployment issues.
const NORMALIZATION_CEILING = 1000;

export interface ScorerOptions {
  weights?: Partial<DeploymentRiskWeights>;
  severityMultipliers?: Partial<SeverityMultipliers>;
  /** Override the normalization ceiling (advanced). */
  normalizationCeiling?: number;
}

export class SorobanDeploymentRiskScorer {
  private readonly weights: DeploymentRiskWeights;
  private readonly multipliers: SeverityMultipliers;
  private readonly ceiling: number;

  constructor(options: ScorerOptions = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...options.weights };
    this.multipliers = { ...DEFAULT_SEVERITY_MULTIPLIERS, ...options.severityMultipliers };
    this.ceiling = options.normalizationCeiling ?? NORMALIZATION_CEILING;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  score(findings: NormalizedFinding[]): DeploymentRiskScore {
    if (findings.length === 0) {
      return this.buildEmptyScore();
    }

    // 1. Severity counts
    const severityCounts = this.countBySeverity(findings);

    // 2. Per-category raw score accumulation
    const categoryRaw = this.accumulateCategoryPoints(findings);

    // 3. Total raw points
    const totalRaw = Object.values(categoryRaw).reduce((s, v) => s + v.rawPoints, 0);

    // 4. Normalize to 0–100
    const overallScore = Math.min(100, Math.round((totalRaw / this.ceiling) * 100));

    // 5. Per-category contribution (share of overallScore)
    const categoryBreakdown = this.buildBreakdown(categoryRaw, totalRaw, overallScore);

    // 6. Top findings (sorted by individual point contribution, descending)
    const topFindings = this.selectTopFindings(findings);

    // 7. Total gas cost
    const totalGasCost = findings.reduce((s, f) => s + (f.estimatedGasCost ?? 0), 0);

    // 8. Grade + risk level
    const grade = this.toGrade(overallScore);
    const riskLevel = this.toRiskLevel(overallScore, severityCounts.critical);

    // 9. Explanation + recommendations
    const explanation = this.buildExplanation(overallScore, categoryBreakdown, severityCounts);
    const recommendations = this.buildRecommendations(severityCounts, categoryBreakdown, totalGasCost);

    return {
      overallScore,
      grade,
      riskLevel,
      categoryBreakdown,
      severityCounts,
      topFindings,
      totalGasCost,
      explanation,
      recommendations,
      meta: {
        totalFindings: findings.length,
        scoredAt: new Date().toISOString(),
        weightsUsed: { ...this.weights },
      },
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private countBySeverity(findings: NormalizedFinding[]) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) counts[f.severity]++;
    return counts;
  }

  /**
   * Accumulates per-category raw points using:
   *   points = severityMultiplier × categoryWeight
   */
  private accumulateCategoryPoints(
    findings: NormalizedFinding[],
  ): Record<FindingCategory, { rawPoints: number; count: number }> {
    const acc: Record<FindingCategory, { rawPoints: number; count: number }> = {
      security: { rawPoints: 0, count: 0 },
      resource: { rawPoints: 0, count: 0 },
      deployment: { rawPoints: 0, count: 0 },
      optimization: { rawPoints: 0, count: 0 },
    };

    for (const f of findings) {
      const multiplier = this.multipliers[f.severity];
      const weight = this.weights[f.category];
      acc[f.category].rawPoints += multiplier * weight;
      acc[f.category].count++;
    }

    return acc;
  }

  private buildBreakdown(
    raw: Record<FindingCategory, { rawPoints: number; count: number }>,
    totalRaw: number,
    overallScore: number,
  ): Record<FindingCategory, CategoryScoreBreakdown> {
    const breakdown = {} as Record<FindingCategory, CategoryScoreBreakdown>;
    const categories: FindingCategory[] = ['security', 'resource', 'deployment', 'optimization'];

    for (const cat of categories) {
      const share = totalRaw > 0 ? raw[cat].rawPoints / totalRaw : 0;
      breakdown[cat] = {
        rawPoints: raw[cat].rawPoints,
        count: raw[cat].count,
        contribution: Math.round(share * overallScore),
      };
    }

    return breakdown;
  }

  /**
   * Sorts findings by their individual point contribution and returns top 5.
   */
  private selectTopFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
    return [...findings]
      .sort((a, b) => {
        const aPoints = this.multipliers[a.severity] * this.weights[a.category];
        const bPoints = this.multipliers[b.severity] * this.weights[b.category];
        return bPoints - aPoints;
      })
      .slice(0, 5);
  }

  // ─── Grade + risk level ───────────────────────────────────────────────────

  private toGrade(score: number): RiskGrade {
    if (score < 20) return 'A';
    if (score < 40) return 'B';
    if (score < 60) return 'C';
    if (score < 80) return 'D';
    return 'F';
  }

  private toRiskLevel(score: number, criticalCount: number): RiskLevel {
    if (criticalCount > 0) return 'critical';
    if (score >= 70) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 30) return 'medium';
    if (score >= 10) return 'low';
    return 'minimal';
  }

  // ─── Explanation ──────────────────────────────────────────────────────────

  private buildExplanation(
    score: number,
    breakdown: Record<FindingCategory, CategoryScoreBreakdown>,
    severityCounts: Record<string, number>,
  ): string[] {
    const lines: string[] = [];

    lines.push(`Overall deployment risk score: ${score}/100 (${this.toGrade(score)}).`);

    if (severityCounts['critical'] > 0) {
      lines.push(
        `${severityCounts['critical']} critical finding(s) detected — these are the primary drivers of risk.`,
      );
    }

    const categories: FindingCategory[] = ['security', 'resource', 'deployment', 'optimization'];
    for (const cat of categories) {
      const b = breakdown[cat];
      if (b.count > 0) {
        lines.push(
          `${capitalize(cat)}: ${b.count} finding(s) contributing ${b.contribution} points ` +
            `(weight: ${this.weights[cat]}, raw: ${b.rawPoints}).`,
        );
      }
    }

    return lines;
  }

  // ─── Recommendations ──────────────────────────────────────────────────────

  private buildRecommendations(
    severityCounts: Record<string, number>,
    breakdown: Record<FindingCategory, CategoryScoreBreakdown>,
    totalGasCost: number,
  ): string[] {
    const recs: string[] = [];

    if (severityCounts['critical'] > 0) {
      recs.push(
        `🚨 Resolve ${severityCounts['critical']} critical issue(s) before deploying — these represent severe security or resource risks.`,
      );
    }
    if (severityCounts['high'] > 0) {
      recs.push(
        `⚠️  Address ${severityCounts['high']} high-severity issue(s) before the next release.`,
      );
    }
    if (breakdown.security.count > 0) {
      recs.push(
        `🔒 ${breakdown.security.count} security finding(s) found — perform a thorough security audit and add authorization tests.`,
      );
    }
    if (breakdown.deployment.count > 0) {
      recs.push(
        `🚀 ${breakdown.deployment.count} deployment finding(s) found — review WASM binary size, host-import call patterns, and stack frame usage.`,
      );
    }
    if (breakdown.resource.count > 0) {
      recs.push(
        `⚙️  ${breakdown.resource.count} resource finding(s) found — check CPU/memory cost estimations and storage rent patterns.`,
      );
    }
    if (totalGasCost > 500) {
      recs.push(
        `⛽ Estimated cumulative gas cost: ${totalGasCost.toLocaleString()} units — optimizing flagged patterns could reduce fees significantly.`,
      );
    }
    if (recs.length === 0) {
      recs.push('✅ No significant issues detected. Contract looks deployment-ready.');
    }

    return recs;
  }

  // ─── Empty score ──────────────────────────────────────────────────────────

  private buildEmptyScore(): DeploymentRiskScore {
    const emptyBreakdown: Record<FindingCategory, CategoryScoreBreakdown> = {
      security: { rawPoints: 0, count: 0, contribution: 0 },
      resource: { rawPoints: 0, count: 0, contribution: 0 },
      deployment: { rawPoints: 0, count: 0, contribution: 0 },
      optimization: { rawPoints: 0, count: 0, contribution: 0 },
    };

    return {
      overallScore: 0,
      grade: 'A',
      riskLevel: 'minimal',
      categoryBreakdown: emptyBreakdown,
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      topFindings: [],
      totalGasCost: 0,
      explanation: ['No findings reported. Contract appears clean.'],
      recommendations: ['✅ No significant issues detected. Contract looks deployment-ready.'],
      meta: {
        totalFindings: 0,
        scoredAt: new Date().toISOString(),
        weightsUsed: { ...this.weights },
      },
    };
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
