import { Finding, Severity } from '@engine/core';

export interface FunctionRiskScore {
  functionName: string;
  overallScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
  securityScore: number;
  optimizationScore: number;
  gasScore: number;
  maintainabilityScore: number;
  severityBreakdown: Record<Severity, number>;
  categoryBreakdown: Record<string, number>;
  findings: Finding[];
  recommendations: string[];
}

export interface FunctionRiskScoringWeights {
  security: number;
  optimization: number;
  gas: number;
  maintainability: number;
}

export interface FunctionRiskScoringConfig {
  weights?: Partial<FunctionRiskScoringWeights>;
  severityMultipliers?: Partial<Record<Severity, number>>;
  categoryWeights?: Record<string, number>;
  unknownFunctionLabel?: string;
}

const DEFAULT_FUNCTION_RISK_CONFIG: Required<FunctionRiskScoringConfig> = {
  weights: {
    security: 10,
    optimization: 7,
    gas: 5,
    maintainability: 3,
  },
  severityMultipliers: {
    [Severity.CRITICAL]: 10,
    [Severity.HIGH]: 7,
    [Severity.MEDIUM]: 4,
    [Severity.LOW]: 2,
    [Severity.INFO]: 1,
  },
  categoryWeights: {
    security: 10,
    optimization: 7,
    gas: 5,
    maintainability: 3,
  },
  unknownFunctionLabel: 'unknown',
};

export class FunctionRiskScoringEngine {
  private config: Required<FunctionRiskScoringConfig>;

  constructor(config?: FunctionRiskScoringConfig) {
    this.config = {
      ...DEFAULT_FUNCTION_RISK_CONFIG,
      ...config,
      weights: {
        ...DEFAULT_FUNCTION_RISK_CONFIG.weights,
        ...config?.weights,
      },
      severityMultipliers: {
        ...DEFAULT_FUNCTION_RISK_CONFIG.severityMultipliers,
        ...config?.severityMultipliers,
      },
      categoryWeights: {
        ...DEFAULT_FUNCTION_RISK_CONFIG.categoryWeights,
        ...config?.categoryWeights,
      },
      unknownFunctionLabel:
        config?.unknownFunctionLabel ??
        DEFAULT_FUNCTION_RISK_CONFIG.unknownFunctionLabel,
    };
  }

  scoreByFunction(findings: Finding[]): FunctionRiskScore[] {
    const grouped = this.groupFindingsByFunction(findings);
    const scored = Object.entries(grouped).map(([functionName, functionFindings]) =>
      this.scoreFunction(functionName, functionFindings),
    );

    return scored.sort((a, b) => b.overallScore - a.overallScore);
  }

  private scoreFunction(
    functionName: string,
    findings: Finding[],
  ): FunctionRiskScore {
    const severityBreakdown = this.buildSeverityBreakdown(findings);
    const categoryBreakdown = this.buildCategoryBreakdown(findings);

    const securityScore = this.calculateCategoryScore(findings, 'security');
    const optimizationScore = this.calculateCategoryScore(findings, 'optimization');
    const gasScore = this.calculateCategoryScore(findings, 'gas');
    const maintainabilityScore = this.calculateCategoryScore(
      findings,
      'maintainability',
    );

    const overallScore = this.calculateOverallScore(
      securityScore,
      optimizationScore,
      gasScore,
      maintainabilityScore,
      severityBreakdown,
    );

    const riskLevel = this.determineRiskLevel(overallScore, severityBreakdown);
    const recommendations = this.generateRecommendations(
      functionName,
      findings,
      severityBreakdown,
    );

    return {
      functionName,
      overallScore,
      riskLevel,
      securityScore,
      optimizationScore,
      gasScore,
      maintainabilityScore,
      severityBreakdown,
      categoryBreakdown,
      findings,
      recommendations,
    };
  }

  private groupFindingsByFunction(findings: Finding[]): Record<string, Finding[]> {
    return findings.reduce<Record<string, Finding[]>>((groups, finding) => {
      const functionName = this.getFunctionName(finding);
      if (!groups[functionName]) {
        groups[functionName] = [];
      }
      groups[functionName].push(finding);
      return groups;
    }, {});
  }

  private getFunctionName(finding: Finding): string {
    const metadata = finding.metadata as Record<string, any> | undefined;
    const candidates: Array<string | undefined> = [];

    if (metadata) {
      candidates.push(metadata.functionName as string | undefined);
      candidates.push(metadata.function as string | undefined);
      candidates.push(metadata?.function?.name as string | undefined);
    }

    const extracted = this.extractFunctionNameFromMessage(finding.message);
    if (extracted) {
      candidates.push(extracted);
    }

    const firstValid = candidates.find(
      (candidate) => this.isValidFunctionName(candidate),
    );

    return firstValid?.trim() ?? this.config.unknownFunctionLabel;
  }

  private isValidFunctionName(candidate: string | undefined): candidate is string {
    if (!candidate || typeof candidate !== 'string') return false;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) return false;

    const invalidNames = new Set([
      'should',
      'must',
      'can',
      'may',
      'has',
      'have',
      'is',
      'are',
      'the',
      'a',
      'an',
      'this',
      'that',
      'it',
      'function',
    ]);

    return !invalidNames.has(trimmed.toLowerCase());
  }

  private extractFunctionNameFromMessage(message: string): string | undefined {
    const match = message.match(/function\s+['"`]?([A-Za-z_][A-Za-z0-9_]*)['"`]*/i);
    if (!match) return undefined;
    const candidate = match[1];
    return this.isValidFunctionName(candidate) ? candidate : undefined;
  }

  private buildSeverityBreakdown(findings: Finding[]): Record<Severity, number> {
    return findings.reduce<Record<Severity, number>>(
      (breakdown, finding) => {
        breakdown[finding.severity] = (breakdown[finding.severity] || 0) + 1;
        return breakdown;
      },
      {
        [Severity.CRITICAL]: 0,
        [Severity.HIGH]: 0,
        [Severity.MEDIUM]: 0,
        [Severity.LOW]: 0,
        [Severity.INFO]: 0,
      },
    );
  }

  private buildCategoryBreakdown(findings: Finding[]): Record<string, number> {
    return findings.reduce<Record<string, number>>((breakdown, finding) => {
      const category = this.categorizeFinding(finding);
      breakdown[category] = (breakdown[category] || 0) + 1;
      return breakdown;
    }, {});
  }

  private calculateCategoryScore(
    findings: Finding[],
    category: string,
  ): number {
    const categoryFindings = findings.filter(
      (finding) => this.categorizeFinding(finding) === category,
    );

    const score = categoryFindings.reduce((sum, finding) => {
      const weight = this.config.weights[category as keyof FunctionRiskScoringWeights] ?? 5;
      const multiplier = this.config.severityMultipliers[finding.severity] ?? 1;
      return sum + multiplier * weight;
    }, 0);

    return Math.min(score, 100);
  }

  private calculateOverallScore(
    securityScore: number,
    optimizationScore: number,
    gasScore: number,
    maintainabilityScore: number,
    severityBreakdown: Record<Severity, number>,
  ): number {
    const maxCategoryScore = Math.max(
      securityScore,
      optimizationScore,
      gasScore,
      maintainabilityScore,
    );

    let score = maxCategoryScore;
    score += severityBreakdown[Severity.CRITICAL] * 15;
    score += severityBreakdown[Severity.HIGH] * 8;
    score += severityBreakdown[Severity.MEDIUM] * 3;
    score = Math.min(score, 100);

    return Math.round(score * 100) / 100;
  }

  private determineRiskLevel(
    score: number,
    severityBreakdown: Record<Severity, number>,
  ): FunctionRiskScore['riskLevel'] {
    if (severityBreakdown[Severity.CRITICAL] > 0) {
      return 'critical';
    }
    if (score >= 70) return 'high';
    if (score >= 20) return 'medium';
    if (score >= 10) return 'low';
    return 'minimal';
  }

  private generateRecommendations(
    functionName: string,
    findings: Finding[],
    severityBreakdown: Record<Severity, number>,
  ): string[] {
    const recommendations: string[] = [];
    if (severityBreakdown[Severity.CRITICAL] > 0) {
      recommendations.push(
        `Review ${functionName} immediately: contains critical findings.`,
      );
    }
    if (severityBreakdown[Severity.HIGH] > 0) {
      recommendations.push(
        `Prioritize fixes in ${functionName}; it contains high-risk issues.`,
      );
    }

    const gasFindings = findings.filter(
      (finding) => this.categorizeFinding(finding) === 'gas',
    );
    if (gasFindings.length > 0) {
      recommendations.push(
        `Reduce gas-intensive operations in ${functionName} to improve reliability and cost.`,
      );
    }

    const securityFindings = findings.filter(
      (finding) => this.categorizeFinding(finding) === 'security',
    );
    if (securityFindings.length > 0) {
      recommendations.push(
        `Validate access control and external call handling inside ${functionName}.`,
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(`Monitor ${functionName} and keep testing after refactor.`);
    }

    return recommendations;
  }

  private categorizeFinding(finding: Finding): string {
    const message = finding.message.toLowerCase();
    const ruleId = finding.ruleId.toLowerCase();

    if (
      message.includes('reentrancy') ||
      ruleId.includes('reentrancy') ||
      message.includes('access') ||
      ruleId.includes('access') ||
      message.includes('overflow') ||
      ruleId.includes('overflow') ||
      message.includes('underflow') ||
      ruleId.includes('underflow') ||
      ruleId.includes('auth')
    ) {
      return 'security';
    }

    if (
      message.includes('gas') ||
      ruleId.includes('gas') ||
      message.includes('storage') ||
      ruleId.includes('storage') ||
      message.includes('expensive') ||
      ruleId.includes('expensive')
    ) {
      return 'gas';
    }

    if (
      message.includes('optimization') ||
      ruleId.includes('optim') ||
      message.includes('inefficient') ||
      ruleId.includes('inefficient')
    ) {
      return 'optimization';
    }

    return 'maintainability';
  }
}

export function calculateFunctionRiskScores(
  findings: Finding[],
  config?: FunctionRiskScoringConfig,
): FunctionRiskScore[] {
  const engine = new FunctionRiskScoringEngine(config);
  return engine.scoreByFunction(findings);
}
