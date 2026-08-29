import { ComplexityConfig, ComplexityMetrics, ComplexityReport, FunctionComplexity } from './types';

export class StellarComplexityAnalyzer {
  private source: string;
  private filePath: string;
  private config: ComplexityConfig;

  constructor(
    source: string,
    filePath: string,
    config: ComplexityConfig = { thresholds: { low: 5, medium: 10, high: 20 }, includePrivate: true },
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = config;
  }

  analyze(): ComplexityReport {
    const contractName = this.extractContractName();
    const functions = this.analyzeFunctions();

    const totalComplexity = functions.reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0);
    const averageComplexity = functions.length > 0 ? Math.round(totalComplexity / functions.length) : 0;
    const highestComplexity = functions.length > 0
      ? functions.reduce((max, f) => f.metrics.cyclomaticComplexity > max.metrics.cyclomaticComplexity ? f : max)
      : null;

    const riskBreakdown = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const f of functions) {
      riskBreakdown[f.riskLevel]++;
    }

    return {
      contractName,
      functions,
      totalComplexity,
      averageComplexity,
      highestComplexity,
      riskBreakdown,
      summary: this.generateSummary(contractName, functions.length, totalComplexity, averageComplexity, riskBreakdown),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/)
      || this.source.match(/#\[contract\]\s*\n.*?pub\s+(?:struct|fn)\s+(\w+)/)
      || this.source.match(/contract\s+(\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private analyzeFunctions(): FunctionComplexity[] {
    const functions: FunctionComplexity[] = [];
    const fnRegex = /(pub\s+)?fn\s+(\w+)\s*\(/g;
    let match;

    while ((match = fnRegex.exec(this.source)) !== null) {
      const name = match[2];
      const body = this.extractFunctionBody(match.index);

      const metrics = this.calculateMetrics(body);
      const riskLevel = this.determineRiskLevel(metrics.cyclomaticComplexity);
      const recommendation = this.getRecommendation(name, metrics, riskLevel);

      functions.push({
        name,
        line: this.getLineNumber(match.index),
        metrics,
        riskLevel,
        recommendation,
      });
    }

    return functions;
  }

  private extractFunctionBody(fnStart: number): string {
    const openBrace = this.source.indexOf('{', fnStart);
    if (openBrace === -1) return '';

    let braceCount = 1;
    let body = '';
    for (let i = openBrace + 1; i < this.source.length && braceCount > 0; i++) {
      if (this.source[i] === '{') braceCount++;
      else if (this.source[i] === '}') braceCount--;
      if (braceCount > 0) body += this.source[i];
    }
    return body;
  }

  private calculateMetrics(body: string): ComplexityMetrics {
    const cyclomaticComplexity = 1
      + (body.match(/\bif\b/g) || []).length
      + (body.match(/\belse if\b/g) || []).length
      + (body.match(/\bmatch\b/g) || []).length
      + (body.match(/\bcase\b/g) || []).length
      + (body.match(/&&/g) || []).length
      + (body.match(/\|\|/g) || []).length;

    const cognitiveComplexity = this.calculateCognitiveComplexity(body);
    const branchCount = (body.match(/\bif\b|\belse\b/g) || []).length;
    const loopCount = (body.match(/\bfor\b|\bwhile\b|\bloop\b/g) || []).length;
    const nestingDepth = this.calculateNestingDepth(body);
    const recursionDepth = this.detectRecursion(body);

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      functionCount: 0,
      branchCount,
      loopCount,
      recursionDepth,
      nestingDepth,
    };
  }

  private calculateCognitiveComplexity(body: string): number {
    let score = 0;
    if (body.match(/\bif\b/g)) score += (body.match(/\bif\b/g) || []).length;
    if (body.match(/\bmatch\b/g)) score += (body.match(/\bmatch\b/g) || []).length * 2;
    if (body.match(/\bfor\b|\bwhile\b/g)) score += (body.match(/\bfor\b|\bwhile\b/g) || []).length * 2;
    if (body.match(/\btry\b/g)) score += (body.match(/\btry\b/g) || []).length;
    return score;
  }

  private calculateNestingDepth(body: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    for (const char of body) {
      if (char === '{') currentDepth++;
      if (char === '}') currentDepth--;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    return maxDepth;
  }

  private detectRecursion(body: string): number {
    return 0;
  }

  private determineRiskLevel(complexity: number): FunctionComplexity['riskLevel'] {
    if (complexity > this.config.thresholds.high) return 'critical';
    if (complexity > this.config.thresholds.medium) return 'high';
    if (complexity > this.config.thresholds.low) return 'medium';
    return 'low';
  }

  private getRecommendation(name: string, metrics: ComplexityMetrics, riskLevel: string): string {
    if (riskLevel === 'critical') {
      return `Function "${name}" has critical complexity (${metrics.cyclomaticComplexity}). Consider splitting into smaller helper functions.`;
    }
    if (riskLevel === 'high') {
      return `Function "${name}" has high complexity (${metrics.cyclomaticComplexity}). Review for potential simplification.`;
    }
    if (metrics.nestingDepth > 4) {
      return `Function "${name}" has deep nesting (depth ${metrics.nestingDepth}). Consider early returns or guard clauses.`;
    }
    return 'Complexity is within acceptable range.';
  }

  private getLineNumber(offset: number): number {
    return (this.source.substring(0, offset).match(/\n/g) || []).length + 1;
  }

  private generateSummary(
    name: string,
    fnCount: number,
    totalComplexity: number,
    avgComplexity: number,
    riskBreakdown: { low: number; medium: number; high: number; critical: number },
  ): string {
    const critical = riskBreakdown.critical;
    const high = riskBreakdown.high;
    return `Contract "${name}": ${fnCount} function(s), total complexity ${totalComplexity} (avg ${avgComplexity}). ` +
      `${riskBreakdown.low} low, ${riskBreakdown.medium} medium, ${high} high, ${critical} critical.`;
  }
}
