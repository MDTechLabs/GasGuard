export interface StorageGrowthPattern {
  functionName: string;
  lineNumber: number;
  description: string;
  riskLevel: 'medium' | 'high';
}

export interface StorageGrowthWarning {
  message: string;
  lineNumber: number;
  severity: 'medium' | 'high';
}

export interface StorageGrowthReport {
  contractName: string;
  growthPatterns: StorageGrowthPattern[];
  warnings: StorageGrowthWarning[];
  summary: string;
}

export class StellarStorageGrowthAnalyzer {
  private source: string;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
  }

  analyze(): StorageGrowthReport {
    const contractName = this.extractContractName();
    const growthPatterns = this.detectGrowthPatterns();
    const warnings = this.buildWarnings(growthPatterns);

    return {
      contractName,
      growthPatterns,
      warnings,
      summary: this.buildSummary(contractName, growthPatterns, warnings),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private detectGrowthPatterns(): StorageGrowthPattern[] {
    const patterns: StorageGrowthPattern[] = [];
    const functionRegex = /fn\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = functionRegex.exec(this.source)) !== null) {
      const functionName = match[1];
      const body = this.extractFunctionBody(functionName);
      const lineNumber = this.getLineNumber(match.index);

      const hasStorageMutation = /storage\(\)\.(instance|persistent|temporary)\(\)\.set/.test(body);
      const hasGrowthMutation = /push_back|push\(|insert\(|extend\(|append\(|Vec<|Map<|vec!/.test(body);
      const isGrowthPattern = hasStorageMutation && hasGrowthMutation;

      if (isGrowthPattern) {
        patterns.push({
          functionName,
          lineNumber,
          description: 'Function appears to append or persist data in a way that may cause storage growth over time.',
          riskLevel: body.includes('push_back') || body.includes('push(') ? 'high' : 'medium',
        });
      }
    }

    return patterns;
  }

  private buildWarnings(patterns: StorageGrowthPattern[]): StorageGrowthWarning[] {
    return patterns.map(pattern => ({
      message: `Storage growth risk detected in function '${pattern.functionName}': ${pattern.description}`,
      lineNumber: pattern.lineNumber,
      severity: pattern.riskLevel,
    }));
  }

  private buildSummary(
    contractName: string,
    patterns: StorageGrowthPattern[],
    warnings: StorageGrowthWarning[],
  ): string {
    return `${contractName} storage growth analysis: ${patterns.length} growth pattern(s) detected, ${warnings.length} warning(s) generated.`;
  }

  private extractFunctionBody(functionName: string): string {
    const fnPattern = new RegExp(`fn\\s+${functionName}\\s*\\(`);
    const match = this.source.match(fnPattern);
    if (!match) return '';

    const start = match.index ?? 0;
    const bodyStart = this.source.indexOf('{', start);
    if (bodyStart === -1) return '';

    let depth = 1;
    let i = bodyStart + 1;
    let body = '';

    while (i < this.source.length && depth > 0) {
      const ch = this.source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) body += ch;
      i++;
    }

    return body;
  }

  private getLineNumber(offset: number): number {
    return (this.source.slice(0, offset).match(/\n/g) ?? []).length + 1;
  }
}
