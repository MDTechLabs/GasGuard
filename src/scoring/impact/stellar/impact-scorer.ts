/**
 * Soroban Rule Impact Scorer
 *
 * Assigns impact scores to findings beyond severity by evaluating
 * exploitability, reachability, value-at-risk, and business impact
 * dimensions. Generates an ImpactReport that includes overall impact,
 * per-category breakdown, and recommendations.
 */

import { Finding, Severity } from '@engine/core';

import {
  ImpactCategory,
  ImpactFactor,
  ImpactScore,
  ImpactReport,
  ImpactScoringConfig,
} from './types';

const DEFAULT_CONFIG: Required<ImpactScoringConfig> = {
  weights: {
    [ImpactCategory.EXPLOITABILITY]: 10,
    [ImpactCategory.REACHABILITY]: 8,
    [ImpactCategory.VALUE_AT_RISK]: 7,
    [ImpactCategory.BUSINESS_IMPACT]: 9,
    [ImpactCategory.GAS_EFFICIENCY]: 3,
    [ImpactCategory.CODE_QUALITY]: 2,
  },
  thresholds: {
    critical: 44,
    high: 30,
    medium: 15,
    low: 8,
  },
  exploitabilityFactors: {
    requiresAuthBypass: 3,
    requiresPreviousState: 2,
    requiresUserInteraction: 1,
    directExploit: 15,
  },
};

export class ImpactScorer {
  private config: Required<ImpactScoringConfig>;

  constructor(config?: Partial<ImpactScoringConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      weights: {
        ...DEFAULT_CONFIG.weights,
        ...config?.weights,
      },
      thresholds: {
        ...DEFAULT_CONFIG.thresholds,
        ...config?.thresholds,
      },
      exploitabilityFactors: {
        ...DEFAULT_CONFIG.exploitabilityFactors,
        ...config?.exploitabilityFactors,
      },
    };
  }

  /**
   * Score a single finding and return an ImpactScore.
   */
  scoreFinding(finding: Finding): ImpactScore {
    const factors = this.computeFactors(finding);
    const exploitability = this.computeCategoryScore(
      finding,
      ImpactCategory.EXPLOITABILITY,
    );
    const reachability = this.computeCategoryScore(
      finding,
      ImpactCategory.REACHABILITY,
    );
    const valueAtRisk = this.computeCategoryScore(
      finding,
      ImpactCategory.VALUE_AT_RISK,
    );
    const businessImpact = this.computeCategoryScore(
      finding,
      ImpactCategory.BUSINESS_IMPACT,
    );

    const overall = this.computeOverallScore(
      exploitability,
      reachability,
      valueAtRisk,
      businessImpact,
    );
    const impactLevel = this.determineImpactLevel(overall);

    return {
      overall,
      impactLevel,
      factors,
      exploitability,
      reachability,
      valueAtRisk,
      businessImpact,
    };
  }

  /**
   * Score multiple findings and return impact scores for each.
   */
  scoreFindings(findings: Finding[]): ImpactScore[] {
    return findings.map((finding) => this.scoreFinding(finding));
  }

  /**
   * Generate a detailed ImpactReport for a single finding.
   */
  generateReport(finding: Finding): ImpactReport {
    const impactScore = this.scoreFinding(finding);
    const perCategoryBreakdown = this.buildCategoryBreakdown(finding);
    const recommendations = this.generateRecommendations(
      finding,
      impactScore,
    );

    return {
      findingId: `${finding.ruleId}-${finding.location.startLine}`,
      ruleId: finding.ruleId,
      message: finding.message,
      severity: finding.severity,
      impactScore,
      perCategoryBreakdown,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate impact reports for all given findings.
   */
  generateReports(findings: Finding[]): ImpactReport[] {
    return findings.map((finding) => this.generateReport(finding));
  }

  /**
   * Compute individual impact factors for a finding.
   */
  private computeFactors(finding: Finding): ImpactFactor[] {
    const factors: ImpactFactor[] = [];

    factors.push({
      category: ImpactCategory.EXPLOITABILITY,
      score: this.computeCategoryScore(finding, ImpactCategory.EXPLOITABILITY),
      weight: this.config.weights[ImpactCategory.EXPLOITABILITY],
      description: this.describeExploitability(finding),
    });

    factors.push({
      category: ImpactCategory.REACHABILITY,
      score: this.computeCategoryScore(finding, ImpactCategory.REACHABILITY),
      weight: this.config.weights[ImpactCategory.REACHABILITY],
      description: this.describeReachability(finding),
    });

    factors.push({
      category: ImpactCategory.VALUE_AT_RISK,
      score: this.computeCategoryScore(finding, ImpactCategory.VALUE_AT_RISK),
      weight: this.config.weights[ImpactCategory.VALUE_AT_RISK],
      description: this.describeValueAtRisk(finding),
    });

    factors.push({
      category: ImpactCategory.BUSINESS_IMPACT,
      score: this.computeCategoryScore(finding, ImpactCategory.BUSINESS_IMPACT),
      weight: this.config.weights[ImpactCategory.BUSINESS_IMPACT],
      description: this.describeBusinessImpact(finding),
    });

    return factors;
  }

  /**
   * Compute score for a specific impact category.
   */
  private computeCategoryScore(
    finding: Finding,
    category: ImpactCategory,
  ): number {
    const message = finding.message.toLowerCase();
    const ruleId = finding.ruleId.toLowerCase();

    switch (category) {
      case ImpactCategory.EXPLOITABILITY:
        return this.scoreExploitability(finding, message, ruleId);
      case ImpactCategory.REACHABILITY:
        return this.scoreReachability(finding, message, ruleId);
      case ImpactCategory.VALUE_AT_RISK:
        return this.scoreValueAtRisk(finding, message, ruleId);
      case ImpactCategory.BUSINESS_IMPACT:
        return this.scoreBusinessImpact(finding, message, ruleId);
      case ImpactCategory.GAS_EFFICIENCY:
        return this.scoreGasEfficiency(finding, message, ruleId);
      case ImpactCategory.CODE_QUALITY:
        return this.scoreCodeQuality(finding, message, ruleId);
      default:
        return 0;
    }
  }

  /**
   * Score exploitability: how easy is it to exploit this finding?
   */
  private scoreExploitability(
    finding: Finding,
    message: string,
    ruleId: string,
  ): number {
    let score = 0;

    // Severity-based baseline
    const baseScore: Record<string, number> = {
      [Severity.CRITICAL]: 40,
      [Severity.HIGH]: 25,
      [Severity.MEDIUM]: 15,
      [Severity.LOW]: 8,
      [Severity.INFO]: 3,
    };
    score += baseScore[finding.severity] ?? 0;

    // Keyword-based scoring
    if (
      message.includes('reentrancy') ||
      ruleId.includes('reentrancy')
    ) {
      score += this.config.exploitabilityFactors.directExploit;
    }
    if (
      message.includes('auth') ||
      ruleId.includes('auth') ||
      message.includes('access control')
    ) {
      score += this.config.exploitabilityFactors.requiresAuthBypass;
    }
    if (message.includes('overflow') || ruleId.includes('overflow')) {
      score += this.config.exploitabilityFactors.directExploit;
    }
    if (message.includes('unsafe') || message.includes('unchecked')) {
      score += this.config.exploitabilityFactors.requiresPreviousState;
    }

    return Math.min(score, 100);
  }

  /**
   * Score reachability: can the vulnerable code path be reached?
   */
  private scoreReachability(
    finding: Finding,
    message: string,
    ruleId: string,
  ): number {
    let score = 0;

    switch (finding.severity) {
      case Severity.CRITICAL:
        score += 40;
        break;
      case Severity.HIGH:
        score += 30;
        break;
      case Severity.MEDIUM:
        score += 20;
        break;
      case Severity.LOW:
        score += 10;
        break;
      default:
        score += 5;
    }

    // Public functions increase reachability
    if (
      message.includes('public') ||
      message.includes('external') ||
      ruleId.includes('public')
    ) {
      score += 20;
    }

    // Internal or private functions reduce reachability
    if (
      message.includes('internal') ||
      message.includes('private')
    ) {
      score -= 15;
    }

    return Math.max(0, Math.min(score, 100));
  }

  /**
   * Score value-at-risk: what is the potential financial or data loss?
   */
  private scoreValueAtRisk(
    finding: Finding,
    message: string,
    ruleId: string,
  ): number {
    let score = 0;

    switch (finding.severity) {
      case Severity.CRITICAL:
        score += 35;
        break;
      case Severity.HIGH:
        score += 25;
        break;
      case Severity.MEDIUM:
        score += 15;
        break;
      default:
        score += 5;
    }

    if (
      message.includes('transfer') ||
      message.includes('withdraw') ||
      message.includes('balance')
    ) {
      score += 25;
    }
    if (message.includes('admin') || message.includes('owner')) {
      score += 20;
    }
    if (message.includes('storage') || ruleId.includes('storage')) {
      score += 10;
    }

    return Math.min(score, 100);
  }

  /**
   * Score business impact: effect on protocol/contract operations.
   */
  private scoreBusinessImpact(
    finding: Finding,
    message: string,
    ruleId: string,
  ): number {
    let score = 0;

    switch (finding.severity) {
      case Severity.CRITICAL:
        score += 25;
        break;
      case Severity.HIGH:
        score += 18;
        break;
      case Severity.MEDIUM:
        score += 10;
        break;
      case Severity.LOW:
        score += 5;
        break;
      default:
        score += 1;
    }

    if (
      message.includes('admin') ||
      message.includes('owner') ||
      message.includes('governance')
    ) {
      score += 25;
    }
    if (message.includes('pause') || message.includes('emergency')) {
      score += 20;
    }
    if (message.includes('upgrade') || ruleId.includes('upgrade')) {
      score += 15;
    }
    if (
      message.includes('compliance') ||
      ruleId.includes('compliance')
    ) {
      score += 15;
    }

    return Math.min(score, 100);
  }

  /**
   * Score gas efficiency impact.
   */
  private scoreGasEfficiency(
    finding: Finding,
    message: string,
    ruleId: string,
  ): number {
    let score = 0;

    if (
      message.includes('gas') ||
      ruleId.includes('gas') ||
      ruleId.includes('optimiz')
    ) {
      score += 30;
    }
    if (message.includes('loop') || ruleId.includes('loop')) {
      score += 25;
    }
    if (
      message.includes('storage') &&
      (message.includes('expensive') ||
        message.includes('redundant') ||
        message.includes('unnecessary'))
    ) {
      score += 20;
    }

    // Use estimated gas savings if available
    if (finding.estimatedGasSavings && finding.estimatedGasSavings > 0) {
      score += Math.min(finding.estimatedGasSavings / 1000, 25);
    }

    return Math.min(score, 100);
  }

  /**
   * Score code quality impact.
   */
  private scoreCodeQuality(
    finding: Finding,
    message: string,
    ruleId: string,
  ): number {
    let score = 0;

    if (
      message.includes('naming') ||
      message.includes('convention')
    ) {
      score += 20;
    }
    if (message.includes('unused') || ruleId.includes('unused')) {
      score += 15;
    }
    if (
      message.includes('duplicate') ||
      message.includes('redundant')
    ) {
      score += 20;
    }
    if (
      message.includes('documentation') ||
      message.includes('comment')
    ) {
      score += 10;
    }

    return Math.min(score, 100);
  }

  /**
   * Compute the overall impact score as a weighted average of category scores.
   */
  private computeOverallScore(
    exploitability: number,
    reachability: number,
    valueAtRisk: number,
    businessImpact: number,
  ): number {
    const weights = this.config.weights;
    const totalWeight =
      weights[ImpactCategory.EXPLOITABILITY] +
      weights[ImpactCategory.REACHABILITY] +
      weights[ImpactCategory.VALUE_AT_RISK] +
      weights[ImpactCategory.BUSINESS_IMPACT];

    if (totalWeight === 0) return 0;

    const weightedSum =
      exploitability * weights[ImpactCategory.EXPLOITABILITY] +
      reachability * weights[ImpactCategory.REACHABILITY] +
      valueAtRisk * weights[ImpactCategory.VALUE_AT_RISK] +
      businessImpact * weights[ImpactCategory.BUSINESS_IMPACT];

    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  /**
   * Determine impact level from overall score.
   */
  private determineImpactLevel(score: number): ImpactScore['impactLevel'] {
    if (score >= this.config.thresholds.critical) return 'critical';
    if (score >= this.config.thresholds.high) return 'high';
    if (score >= this.config.thresholds.medium) return 'medium';
    if (score >= this.config.thresholds.low) return 'low';
    return 'minimal';
  }

  /**
   * Build per-category breakdown for a finding.
   */
  private buildCategoryBreakdown(
    finding: Finding,
  ): Record<ImpactCategory, number> {
    return {
      [ImpactCategory.EXPLOITABILITY]: this.computeCategoryScore(
        finding,
        ImpactCategory.EXPLOITABILITY,
      ),
      [ImpactCategory.REACHABILITY]: this.computeCategoryScore(
        finding,
        ImpactCategory.REACHABILITY,
      ),
      [ImpactCategory.VALUE_AT_RISK]: this.computeCategoryScore(
        finding,
        ImpactCategory.VALUE_AT_RISK,
      ),
      [ImpactCategory.BUSINESS_IMPACT]: this.computeCategoryScore(
        finding,
        ImpactCategory.BUSINESS_IMPACT,
      ),
      [ImpactCategory.GAS_EFFICIENCY]: this.computeCategoryScore(
        finding,
        ImpactCategory.GAS_EFFICIENCY,
      ),
      [ImpactCategory.CODE_QUALITY]: this.computeCategoryScore(
        finding,
        ImpactCategory.CODE_QUALITY,
      ),
    };
  }

  /**
   * Generate recommendations based on the impact assessment.
   */
  private generateRecommendations(
    finding: Finding,
    impactScore: ImpactScore,
  ): string[] {
    const recommendations: string[] = [];

    if (impactScore.impactLevel === 'critical') {
      recommendations.push(
        'Immediate remediation required: Critical impact vulnerability detected',
      );
    }

    if (impactScore.exploitability >= 50) {
      recommendations.push(
        'High exploitability: Review attack surface and implement additional safeguards',
      );
    }

    if (impactScore.reachability >= 50) {
      recommendations.push(
        'Widely reachable: Consider adding access controls or input validation',
      );
    }

    if (impactScore.valueAtRisk >= 50) {
      recommendations.push(
        'Significant value at risk: Audit associated financial logic thoroughly',
      );
    }

    if (impactScore.businessImpact >= 50) {
      recommendations.push(
        'High business impact: Coordinate with stakeholders for risk mitigation plan',
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        'Low overall impact: Schedule fix during normal maintenance cycle',
      );
    }

    return recommendations;
  }

  // ---- Descriptive helpers ----

  private describeExploitability(finding: Finding): string {
    if (finding.severity === Severity.CRITICAL) {
      return 'Direct exploit possible with minimal prerequisites';
    }
    if (finding.severity === Severity.HIGH) {
      return 'Exploit possible with some prerequisites';
    }
    return 'Limited exploitability or requires specific conditions';
  }

  private describeReachability(finding: Finding): string {
    const message = finding.message.toLowerCase();
    if (message.includes('public') || message.includes('external')) {
      return 'Vulnerable code path is publicly reachable';
    }
    return 'Vulnerable code path requires specific access or conditions';
  }

  private describeValueAtRisk(finding: Finding): string {
    const message = finding.message.toLowerCase();
    if (
      message.includes('transfer') ||
      message.includes('withdraw')
    ) {
      return 'Direct financial assets at risk';
    }
    if (message.includes('admin') || message.includes('owner')) {
      return 'Privileged operations or administrative control at risk';
    }
    return 'Limited direct value at risk';
  }

  private describeBusinessImpact(finding: Finding): string {
    const message = finding.message.toLowerCase();
    if (message.includes('admin') || message.includes('governance')) {
      return 'Critical governance or administrative functionality affected';
    }
    return 'Standard operational impact';
  }
}
