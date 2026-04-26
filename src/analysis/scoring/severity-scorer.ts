import { Finding, Severity } from '@engine/core';

export interface SeverityScore {
  score: number;
  level: 'critical' | 'high' | 'medium' | 'low' | 'info';
  weight: number;
  impact: 'security' | 'gas' | 'performance' | 'maintainability';
  description: string;
}

export interface ScoringConfig {
  weights: {
    security: number;
    gas: number;
    performance: number;
    maintainability: number;
  };
  multipliers: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  gasImpactWeight: number;
}

export class SeverityScoringSystem {
  private config: ScoringConfig;

  constructor(config?: Partial<ScoringConfig>) {
    this.config = {
      weights: {
        security: 10,
        gas: 7,
        performance: 5,
        maintainability: 3,
        ...config?.weights
      },
      multipliers: {
        critical: 10,
        high: 7,
        medium: 4,
        low: 2,
        info: 1,
        ...config?.multipliers
      },
      gasImpactWeight: 0.001, // 1 gas = 0.001 points
      ...config
    };
  }

  scoreFinding(finding: Finding): SeverityScore {
    const baseScore = this.calculateBaseScore(finding);
    const severityMultiplier = this.config.multipliers[finding.severity];
    const gasBonus = this.calculateGasBonus(finding);
    
    const totalScore = (baseScore * severityMultiplier) + gasBonus;
    const level = this.determineScoreLevel(totalScore);

    return {
      score: Math.round(totalScore * 100) / 100,
      level,
      weight: this.getWeightForCategory(finding),
      impact: this.determineImpact(finding),
      description: this.generateScoreDescription(finding, totalScore, level)
    };
  }

  scoreMultipleFindings(findings: Finding[]): {
    totalScore: number;
    averageScore: number;
    severityBreakdown: Record<Severity, number>;
    impactBreakdown: Record<string, number>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  } {
    const scores = findings.map(f => this.scoreFinding(f));
    const totalScore = scores.reduce((sum, score) => sum + score.score, 0);
    const averageScore = totalScore / findings.length;

    const severityBreakdown: Record<Severity, number> = {
      [Severity.CRITICAL]: 0,
      [Severity.HIGH]: 0,
      [Severity.MEDIUM]: 0,
      [Severity.LOW]: 0,
      [Severity.INFO]: 0
    };

    const impactBreakdown: Record<string, number> = {
      security: 0,
      gas: 0,
      performance: 0,
      maintainability: 0
    };

    findings.forEach(finding => {
      severityBreakdown[finding.severity]++;
      const impact = this.determineImpact(finding);
      impactBreakdown[impact]++;
    });

    return {
      totalScore: Math.round(totalScore * 100) / 100,
      averageScore: Math.round(averageScore * 100) / 100,
      severityBreakdown,
      impactBreakdown,
      riskLevel: this.determineRiskLevel(totalScore, findings.length)
    };
  }

  private calculateBaseScore(finding: Finding): number {
    const category = this.determineImpact(finding);
    return this.config.weights[category] || 5;
  }

  private calculateGasBonus(finding: Finding): number {
    if (!finding.estimatedGasSavings) return 0;
    return finding.estimatedGasSavings * this.config.gasImpactWeight;
  }

  private determineScoreLevel(score: number): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    if (score >= 20) return 'low';
    return 'info';
  }

  private determineImpact(finding: Finding): 'security' | 'gas' | 'performance' | 'maintainability' {
    const message = finding.message.toLowerCase();
    const ruleId = finding.ruleId.toLowerCase();
    
    // Security keywords
    const securityKeywords = ['vulnerability', 'attack', 'exploit', 'reentrancy', 'overflow', 'underflow', 'access control'];
    if (securityKeywords.some(keyword => message.includes(keyword) || ruleId.includes(keyword))) {
      return 'security';
    }
    
    // Gas keywords
    const gasKeywords = ['gas', 'optimization', 'cost', 'expensive', 'inefficient'];
    if (gasKeywords.some(keyword => message.includes(keyword) || ruleId.includes(keyword))) {
      return 'gas';
    }
    
    // Performance keywords
    const performanceKeywords = ['performance', 'slow', 'timeout', 'bottleneck'];
    if (performanceKeywords.some(keyword => message.includes(keyword) || ruleId.includes(keyword))) {
      return 'performance';
    }
    
    return 'maintainability';
  }

  private getWeightForCategory(finding: Finding): number {
    const impact = this.determineImpact(finding);
    return this.config.weights[impact] || 5;
  }

  private generateScoreDescription(finding: Finding, score: number, level: string): string {
    const impact = this.determineImpact(finding);
    const gasInfo = finding.estimatedGasSavings 
      ? ` (potential gas savings: ${finding.estimatedGasSavings.toLocaleString()})` 
      : '';
    
    return `${level.charAt(0).toUpperCase() + level.slice(1)} severity ${impact} issue with score ${Math.round(score)}${gasInfo}`;
  }

  private determineRiskLevel(totalScore: number, findingCount: number): 'low' | 'medium' | 'high' | 'critical' {
    const averageScore = totalScore / findingCount;
    
    if (averageScore >= 70 || totalScore >= 200) return 'critical';
    if (averageScore >= 50 || totalScore >= 100) return 'high';
    if (averageScore >= 30 || totalScore >= 50) return 'medium';
    return 'low';
  }

  // Advanced scoring methods for specific scenarios

  scoreSecurityWithGasImpact(finding: Finding, gasImpact: number): SeverityScore {
    const baseScore = this.scoreFinding(finding);
    const securityGasBonus = gasImpact * this.config.gasImpactWeight * 2; // Double weight for security+gas issues
    
    return {
      ...baseScore,
      score: Math.round((baseScore.score + securityGasBonus) * 100) / 100,
      description: `Security issue with gas impact (score: ${Math.round(baseScore.score + securityGasBonus)})`
    };
  }

  scoreComplexityImpact(finding: Finding, cyclomaticComplexity: number): SeverityScore {
    const baseScore = this.scoreFinding(finding);
    const complexityBonus = Math.max(0, (cyclomaticComplexity - 10) * 0.5);
    
    return {
      ...baseScore,
      score: Math.round((baseScore.score + complexityBonus) * 100) / 100,
      description: `${baseScore.description} (complexity bonus: +${complexityBonus.toFixed(1)})`
    };
  }

  scoreRegressionImpact(newFinding: Finding, baselineFinding?: Finding): SeverityScore {
    const baseScore = this.scoreFinding(newFinding);
    
    if (!baselineFinding) {
      return {
        ...baseScore,
        description: `New issue: ${baseScore.description}`
      };
    }

    const baselineScore = this.scoreFinding(baselineFinding);
    const scoreIncrease = baseScore.score - baselineScore.score;
    
    if (scoreIncrease > 0) {
      return {
        ...baseScore,
        score: Math.round(baseScore.score * 1.2 * 100) / 100, // 20% penalty for regression
        description: `Regression: ${baseScore.description} (worsened by +${scoreIncrease.toFixed(1)})`
      };
    }
    
    return baseScore;
  }

  // Utility methods for reporting

  generateSeverityReport(findings: Finding[]): {
    summary: string;
    recommendations: string[];
    priorityOrder: Finding[];
  } {
    const scoredFindings = findings.map(f => ({
      finding: f,
      score: this.scoreFinding(f)
    }));

    const sortedFindings = scoredFindings
      .sort((a, b) => b.score.score - a.score.score)
      .map(sf => sf.finding);

    const criticalCount = scoredFindings.filter(sf => sf.score.level === 'critical').length;
    const highCount = scoredFindings.filter(sf => sf.score.level === 'high').length;
    const totalScore = scoredFindings.reduce((sum, sf) => sum + sf.score.score, 0);

    const summary = `Analysis complete: ${findings.length} findings with total score ${totalScore.toFixed(1)}. ` +
      `${criticalCount} critical, ${highCount} high priority issues.`;

    const recommendations = this.generateRecommendations(scoredFindings);

    return {
      summary,
      recommendations,
      priorityOrder: sortedFindings
    };
  }

  private generateRecommendations(scoredFindings: Array<{ finding: Finding; score: SeverityScore }>): string[] {
    const recommendations: string[] = [];
    
    const criticalIssues = scoredFindings.filter(sf => sf.score.level === 'critical');
    if (criticalIssues.length > 0) {
      recommendations.push(`Address ${criticalIssues.length} critical security issues immediately`);
    }

    const highGasIssues = scoredFindings.filter(sf => 
      sf.score.level === 'high' && sf.score.impact === 'gas'
    );
    if (highGasIssues.length > 0) {
      recommendations.push(`Optimize ${highGasIssues.length} high-impact gas issues for cost savings`);
    }

    const totalGasSavings = scoredFindings
      .filter(sf => sf.finding.estimatedGasSavings)
      .reduce((sum, sf) => sum + (sf.finding.estimatedGasSavings || 0), 0);
    
    if (totalGasSavings > 1000) {
      recommendations.push(`Potential gas savings: ${totalGasSavings.toLocaleString()} units - prioritize optimization`);
    }

    return recommendations;
  }
}
