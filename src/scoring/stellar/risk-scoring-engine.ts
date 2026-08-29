/**
 * Stellar Contract Risk Scoring Engine
 * 
 * Generates security and optimization risk scores for Soroban contracts
 * by aggregating rule findings and applying weighted risk calculations.
 */

import { Finding, Severity } from '@engine/core';

export interface RiskScore {
  overallScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
  securityScore: number;
  optimizationScore: number;
  gasScore: number;
  breakdown: RiskBreakdown;
  recommendations: string[];
}

export interface RiskBreakdown {
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  infoIssues: number;
  byCategory: Record<string, number>;
  bySeverity: Record<Severity, number>;
}

export interface ScoringWeights {
  security: number;
  optimization: number;
  gas: number;
  maintainability: number;
}

export interface ScoringConfig {
  weights: ScoringWeights;
  severityMultipliers: Record<Severity, number>;
  categoryWeights: Record<string, number>;
}

/**
 * Risk scoring engine for Stellar/Soroban contracts
 */
export class StellarRiskScoringEngine {
  private config: ScoringConfig;

  constructor(config?: Partial<ScoringConfig>) {
    this.config = {
      weights: {
        security: 10,
        optimization: 7,
        gas: 5,
        maintainability: 3,
        ...config?.weights
      },
      severityMultipliers: {
        [Severity.CRITICAL]: 10,
        [Severity.HIGH]: 7,
        [Severity.MEDIUM]: 4,
        [Severity.LOW]: 2,
        [Severity.INFO]: 1,
        ...config?.severityMultipliers
      },
      categoryWeights: {
        'reentrancy': 10,
        'access-control': 9,
        'arithmetic': 8,
        'gas': 5,
        'optimization': 4,
        'best-practices': 3,
        'informational': 1,
        ...config?.categoryWeights
      },
      ...config
    };
  }

  /**
   * Calculate risk score from findings
   */
  calculateRiskScore(findings: Finding[]): RiskScore {
    if (findings.length === 0) {
      return this.getMinimalRiskScore();
    }

    const breakdown = this.analyzeBreakdown(findings);
    const securityScore = this.calculateCategoryScore(findings, 'security');
    const optimizationScore = this.calculateCategoryScore(findings, 'optimization');
    const gasScore = this.calculateCategoryScore(findings, 'gas');
    
    const overallScore = this.calculateOverallScore(
      securityScore,
      optimizationScore,
      gasScore,
      breakdown
    );

    const riskLevel = this.determineRiskLevel(overallScore, breakdown);
    const recommendations = this.generateRecommendations(findings, breakdown);

    return {
      overallScore,
      riskLevel,
      securityScore,
      optimizationScore,
      gasScore,
      breakdown,
      recommendations,
    };
  }

  /**
   * Calculate risk score specifically for Soroban contracts
   */
  calculateSorobanRiskScore(findings: Finding[], contractMetrics?: SorobanContractMetrics): RiskScore {
    const baseRiskScore = this.calculateRiskScore(findings);
    
    // Apply Soroban-specific adjustments
    let adjustedScore = baseRiskScore.overallScore;
    
    if (contractMetrics) {
      // Adjust for storage usage
      if (contractMetrics.storageOperations > 100) {
        adjustedScore += 5;
      }
      
      // Adjust for event emissions
      if (contractMetrics.eventEmissions === 0 && contractMetrics.stateChanges > 0) {
        adjustedScore += 3; // Missing events for state changes
      }
      
      // Adjust for auth patterns
      if (!contractMetrics.hasAuthChecks && contractMetrics.publicFunctions > 0) {
        adjustedScore += 8; // Critical: missing auth checks
      }
      
      // Adjust for gas efficiency
      if (contractMetrics.estimatedGas > 1000000) {
        adjustedScore += 4;
      }
    }

    const riskLevel = this.determineRiskLevel(adjustedScore, baseRiskScore.breakdown);

    return {
      ...baseRiskScore,
      overallScore: Math.min(adjustedScore, 100),
      riskLevel,
    };
  }

  /**
   * Compare two risk scores
   */
  compareRiskScores(score1: RiskScore, score2: RiskScore): {
    improved: boolean;
    difference: number;
    summary: string;
  } {
    const difference = score2.overallScore - score1.overallScore;
    const improved = difference < 0;

    let summary = '';
    if (improved) {
      summary = `Risk score improved by ${Math.abs(difference).toFixed(1)} points`;
    } else if (difference > 0) {
      summary = `Risk score increased by ${difference.toFixed(1)} points`;
    } else {
      summary = 'Risk score unchanged';
    }

    return {
      improved,
      difference,
      summary,
    };
  }

  /**
   * Analyze breakdown of findings
   */
  private analyzeBreakdown(findings: Finding[]): RiskBreakdown {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<Severity, number> = {
      [Severity.CRITICAL]: 0,
      [Severity.HIGH]: 0,
      [Severity.MEDIUM]: 0,
      [Severity.LOW]: 0,
      [Severity.INFO]: 0,
    };

    for (const finding of findings) {
      bySeverity[finding.severity]++;
      
      const category = this.categorizeFinding(finding);
      byCategory[category] = (byCategory[category] || 0) + 1;
    }

    return {
      criticalIssues: bySeverity[Severity.CRITICAL],
      highIssues: bySeverity[Severity.HIGH],
      mediumIssues: bySeverity[Severity.MEDIUM],
      lowIssues: bySeverity[Severity.LOW],
      infoIssues: bySeverity[Severity.INFO],
      byCategory,
      bySeverity,
    };
  }

  /**
   * Calculate score for a specific category
   */
  private calculateCategoryScore(findings: Finding[], category: string): number {
    const categoryFindings = findings.filter(f => 
      this.categorizeFinding(f) === category
    );

    let score = 0;
    for (const finding of categoryFindings) {
      const multiplier = this.config.severityMultipliers[finding.severity];
      const weight = this.config.weights[category as keyof ScoringWeights] || 5;
      score += multiplier * weight;
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate overall risk score
   */
  private calculateOverallScore(
    securityScore: number,
    optimizationScore: number,
    gasScore: number,
    breakdown: RiskBreakdown
  ): number {
    // Weighted average of category scores
    const totalWeight = 
      this.config.weights.security + 
      this.config.weights.optimization + 
      this.config.weights.gas;
    
    const weightedSum = 
      (securityScore * this.config.weights.security) +
      (optimizationScore * this.config.weights.optimization) +
      (gasScore * this.config.weights.gas);
    
    let overallScore = weightedSum / totalWeight;

    // Apply severity penalties
    if (breakdown.criticalIssues > 0) {
      overallScore += breakdown.criticalIssues * 10;
    }
    if (breakdown.highIssues > 0) {
      overallScore += breakdown.highIssues * 5;
    }

    return Math.min(overallScore, 100);
  }

  /**
   * Determine risk level from score
   */
  private determineRiskLevel(score: number, breakdown: RiskBreakdown): RiskScore['riskLevel'] {
    // Critical issues always result in critical risk level
    if (breakdown.criticalIssues > 0) {
      return 'critical';
    }

    if (score >= 70) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 30) return 'medium';
    if (score >= 10) return 'low';
    return 'minimal';
  }

  /**
   * Generate recommendations based on findings
   */
  private generateRecommendations(findings: Finding[], breakdown: RiskBreakdown): string[] {
    const recommendations: string[] = [];

    if (breakdown.criticalIssues > 0) {
      recommendations.push(`Address ${breakdown.criticalIssues} critical security issues immediately`);
    }

    if (breakdown.highIssues > 0) {
      recommendations.push(`Review and fix ${breakdown.highIssues} high-priority issues`);
    }

    // Category-specific recommendations
    const securityFindings = findings.filter(f => this.categorizeFinding(f) === 'security');
    if (securityFindings.length > 0) {
      recommendations.push('Implement comprehensive security audit and testing');
    }

    const gasFindings = findings.filter(f => this.categorizeFinding(f) === 'gas');
    if (gasFindings.length > 3) {
      recommendations.push('Optimize gas usage to reduce transaction costs');
    }

    const authFindings = findings.filter(f => 
      f.ruleId.toLowerCase().includes('auth') || 
      f.message.toLowerCase().includes('auth')
    );
    if (authFindings.length > 0) {
      recommendations.push('Review and strengthen access control mechanisms');
    }

    return recommendations;
  }

  /**
   * Categorize a finding
   */
  private categorizeFinding(finding: Finding): string {
    const message = finding.message.toLowerCase();
    const ruleId = finding.ruleId.toLowerCase();

    // Security categories
    if (message.includes('reentrancy') || ruleId.includes('reentrancy')) return 'security';
    if (message.includes('access') || ruleId.includes('access')) return 'security';
    if (message.includes('overflow') || ruleId.includes('overflow')) return 'security';
    if (message.includes('underflow') || ruleId.includes('underflow')) return 'security';

    // Gas categories
    if (message.includes('gas') || ruleId.includes('gas')) return 'gas';
    if (message.includes('storage') || ruleId.includes('storage')) return 'gas';
    if (message.includes('expensive') || ruleId.includes('expensive')) return 'gas';

    // Optimization categories
    if (message.includes('optimization') || ruleId.includes('optim')) return 'optimization';
    if (message.includes('inefficient') || ruleId.includes('inefficient')) return 'optimization';

    // Default to informational
    return 'informational';
  }

  /**
   * Get minimal risk score for contracts with no findings
   */
  private getMinimalRiskScore(): RiskScore {
    return {
      overallScore: 0,
      riskLevel: 'minimal',
      securityScore: 0,
      optimizationScore: 0,
      gasScore: 0,
      breakdown: {
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
        infoIssues: 0,
        byCategory: {},
        bySeverity: {
          [Severity.CRITICAL]: 0,
          [Severity.HIGH]: 0,
          [Severity.MEDIUM]: 0,
          [Severity.LOW]: 0,
          [Severity.INFO]: 0,
        },
      },
      recommendations: ['Contract appears to be well-optimized with no detected issues'],
    };
  }
}

/**
 * Metrics specific to Soroban contracts
 */
export interface SorobanContractMetrics {
  storageOperations: number;
  eventEmissions: number;
  stateChanges: number;
  publicFunctions: number;
  hasAuthChecks: boolean;
  estimatedGas: number;
}

/**
 * Utility function to calculate Soroban contract risk score
 */
export function calculateSorobanContractRisk(
  findings: Finding[],
  metrics?: SorobanContractMetrics,
  config?: Partial<ScoringConfig>
): RiskScore {
  const engine = new StellarRiskScoringEngine(config);
  return engine.calculateSorobanRiskScore(findings, metrics);
}
