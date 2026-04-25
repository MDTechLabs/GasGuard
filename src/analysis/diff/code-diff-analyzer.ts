import { Finding, Severity } from '@engine/core';

export interface CodeDiff {
  filePath: string;
  oldContent?: string;
  newContent: string;
  additions: DiffLine[];
  deletions: DiffLine[];
  modifications: DiffLine[];
}

export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'addition' | 'deletion' | 'modification';
}

export interface GasImpactDiff {
  filePath: string;
  oldGasEstimate?: number;
  newGasEstimate: number;
  gasDifference: number;
  percentChange: number;
  affectedFunctions: FunctionGasDiff[];
}

export interface FunctionGasDiff {
  functionName: string;
  oldGasEstimate?: number;
  newGasEstimate: number;
  gasDifference: number;
  percentChange: number;
  optimizations: string[];
  regressions: string[];
}

export interface SecurityDiff {
  filePath: string;
  newVulnerabilities: Finding[];
  fixedVulnerabilities: Finding[];
  unchangedVulnerabilities: Finding[];
  riskLevelChange: 'improved' | 'degraded' | 'unchanged';
}

export interface DiffAnalysisResult {
  summary: {
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
    functionsModified: number;
    totalGasImpact: number;
    securityImprovements: number;
    securityRegressions: number;
  };
  gasImpacts: GasImpactDiff[];
  securityDiffs: SecurityDiff[];
  recommendations: string[];
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class CodeDiffAnalyzer {
  analyzeDiff(oldCode: string, newCode: string, filePath: string): CodeDiff {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    
    const additions: DiffLine[] = [];
    const deletions: DiffLine[] = [];
    const modifications: DiffLine[] = [];

    // Simple line-by-line diff (in production, would use more sophisticated diff algorithm)
    const maxLines = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      
      if (oldLine === undefined) {
        // Line was added
        additions.push({
          lineNumber: i + 1,
          content: newLine,
          type: 'addition'
        });
      } else if (newLine === undefined) {
        // Line was deleted
        deletions.push({
          lineNumber: i + 1,
          content: oldLine,
          type: 'deletion'
        });
      } else if (oldLine !== newLine) {
        // Line was modified
        modifications.push({
          lineNumber: i + 1,
          content: newLine,
          type: 'modification'
        });
      }
    }

    return {
      filePath,
      oldContent: oldCode,
      newContent: newCode,
      additions,
      deletions,
      modifications
    };
  }

  analyzeGasImpact(oldCode: string, newCode: string, filePath: string): GasImpactDiff {
    const oldGasEstimate = this.estimateGasUsage(oldCode);
    const newGasEstimate = this.estimateGasUsage(newCode);
    const gasDifference = newGasEstimate - oldGasEstimate;
    const percentChange = oldGasEstimate > 0 ? (gasDifference / oldGasEstimate) * 100 : 0;

    const affectedFunctions = this.analyzeFunctionGasDiffs(oldCode, newCode);

    return {
      filePath,
      oldGasEstimate,
      newGasEstimate,
      gasDifference,
      percentChange,
      affectedFunctions
    };
  }

  analyzeSecurityImpact(oldFindings: Finding[], newFindings: Finding[], filePath: string): SecurityDiff {
    const newVulnerabilities: Finding[] = [];
    const fixedVulnerabilities: Finding[] = [];
    const unchangedVulnerabilities: Finding[] = [];

    // Find new vulnerabilities
    for (const newFinding of newFindings) {
      const existsInOld = oldFindings.some(oldFinding => 
        this.areFindingsSimilar(oldFinding, newFinding)
      );
      
      if (!existsInOld) {
        newVulnerabilities.push(newFinding);
      }
    }

    // Find fixed vulnerabilities
    for (const oldFinding of oldFindings) {
      const existsInNew = newFindings.some(newFinding => 
        this.areFindingsSimilar(oldFinding, newFinding)
      );
      
      if (!existsInNew) {
        fixedVulnerabilities.push(oldFinding);
      }
    }

    // Find unchanged vulnerabilities
    for (const newFinding of newFindings) {
      const matchingOld = oldFindings.find(oldFinding => 
        this.areFindingsSimilar(oldFinding, newFinding)
      );
      
      if (matchingOld) {
        unchangedVulnerabilities.push(newFinding);
      }
    }

    // Determine risk level change
    const oldRiskScore = this.calculateRiskScore(oldFindings);
    const newRiskScore = this.calculateRiskScore(newFindings);
    
    let riskLevelChange: 'improved' | 'degraded' | 'unchanged';
    if (newRiskScore < oldRiskScore) {
      riskLevelChange = 'improved';
    } else if (newRiskScore > oldRiskScore) {
      riskLevelChange = 'degraded';
    } else {
      riskLevelChange = 'unchanged';
    }

    return {
      filePath,
      newVulnerabilities,
      fixedVulnerabilities,
      unchangedVulnerabilities,
      riskLevelChange
    };
  }

  performFullDiffAnalysis(
    oldFiles: Map<string, string>,
    newFiles: Map<string, string>,
    oldFindings: Map<string, Finding[]>,
    newFindings: Map<string, Finding[]>
  ): DiffAnalysisResult {
    const gasImpacts: GasImpactDiff[] = [];
    const securityDiffs: SecurityDiff[] = [];
    const recommendations: string[] = [];

    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    let totalGasImpact = 0;
    let securityImprovements = 0;
    let securityRegressions = 0;
    let functionsModified = 0;

    // Analyze each file
    for (const [filePath, newContent] of newFiles) {
      const oldContent = oldFiles.get(filePath);
      
      if (oldContent !== undefined) {
        // File was modified
        const codeDiff = this.analyzeDiff(oldContent, newContent, filePath);
        const gasImpact = this.analyzeGasImpact(oldContent, newContent, filePath);
        const securityDiff = this.analyzeSecurityImpact(
          oldFindings.get(filePath) || [],
          newFindings.get(filePath) || [],
          filePath
        );

        gasImpacts.push(gasImpact);
        securityDiffs.push(securityDiff);

        totalLinesAdded += codeDiff.additions.length;
        totalLinesRemoved += codeDiff.deletions.length;
        totalGasImpact += gasImpact.gasDifference;
        functionsModified += gasImpact.affectedFunctions.length;
        securityImprovements += securityDiff.fixedVulnerabilities.length;
        securityRegressions += securityDiff.newVulnerabilities.length;

        // Generate recommendations
        recommendations.push(...this.generateRecommendations(gasImpact, securityDiff));
      } else {
        // File was added
        const gasImpact = this.analyzeGasImpact('', newContent, filePath);
        const securityDiff = this.analyzeSecurityImpact([], newFindings.get(filePath) || [], filePath);
        
        gasImpacts.push(gasImpact);
        securityDiffs.push(securityDiff);
        
        const codeDiff = this.analyzeDiff('', newContent, filePath);
        totalLinesAdded += codeDiff.additions.length;
        totalGasImpact += gasImpact.gasDifference;
        functionsModified += gasImpact.affectedFunctions.length;
        securityRegressions += securityDiff.newVulnerabilities.length;
      }
    }

    // Check for deleted files
    for (const [filePath, oldContent] of oldFiles) {
      if (!newFiles.has(filePath)) {
        const gasImpact = this.analyzeGasImpact(oldContent, '', filePath);
        const securityDiff = this.analyzeSecurityImpact(
          oldFindings.get(filePath) || [],
          [],
          filePath
        );
        
        gasImpacts.push(gasImpact);
        securityDiffs.push(securityDiff);
        
        totalLinesRemoved += oldContent.split('\n').length;
        securityImprovements += securityDiff.fixedVulnerabilities.length;
      }
    }

    const overallRiskLevel = this.determineOverallRiskLevel(
      totalGasImpact,
      securityRegressions,
      securityImprovements
    );

    return {
      summary: {
        filesChanged: newFiles.size,
        linesAdded: totalLinesAdded,
        linesRemoved: totalLinesRemoved,
        functionsModified: functionsModified,
        totalGasImpact,
        securityImprovements,
        securityRegressions
      },
      gasImpacts,
      securityDiffs,
      recommendations,
      overallRiskLevel
    };
  }

  private estimateGasUsage(code: string): number {
    // Simplified gas estimation (in production, would use actual gas estimator)
    let gasEstimate = 21000; // Base transaction cost

    // Add costs for different patterns
    gasEstimate += (code.match(/function\s+\w+/g) || []).length * 1000; // Function declarations
    gasEstimate += (code.match(/require\s*\(/g) || []).length * 200; // Require statements
    gasEstimate += (code.match(/\.call\s*\(/g) || []).length * 700; // External calls
    gasEstimate += (code.match(/storage\s+\w+/g) || []).length * 20000; // Storage variables
    gasEstimate += (code.match(/mapping\s*\(/g) || []).length * 10000; // Mappings
    gasEstimate += code.split('\n').length * 10; // Per-line overhead

    return gasEstimate;
  }

  private analyzeFunctionGasDiffs(oldCode: string, newCode: string): FunctionGasDiff[] {
    const oldFunctions = this.extractFunctions(oldCode);
    const newFunctions = this.extractFunctions(newCode);
    const diffs: FunctionGasDiff[] = [];

    for (const [funcName, newFunc] of newFunctions) {
      const oldFunc = oldFunctions.get(funcName);
      const oldGasEstimate = oldFunc ? this.estimateGasUsage(oldFunc) : 0;
      const newGasEstimate = this.estimateGasUsage(newFunc);
      const gasDifference = newGasEstimate - oldGasEstimate;
      const percentChange = oldGasEstimate > 0 ? (gasDifference / oldGasEstimate) * 100 : 0;

      const optimizations = this.identifyOptimizations(oldFunc, newFunc);
      const regressions = this.identifyRegressions(oldFunc, newFunc);

      diffs.push({
        functionName: funcName,
        oldGasEstimate,
        newGasEstimate,
        gasDifference,
        percentChange,
        optimizations,
        regressions
      });
    }

    return diffs;
  }

  private extractFunctions(code: string): Map<string, string> {
    const functions = new Map<string, string>();
    const lines = code.split('\n');
    let currentFunction = '';
    let functionName = '';
    let braceCount = 0;
    let inFunction = false;

    for (const line of lines) {
      const functionMatch = line.match(/function\s+(\w+)\s*\([^)]*\)\s*(?:public|private|external|internal)?\s*(?:returns\s*\([^)]*\))?\s*\{/);
      
      if (functionMatch && !inFunction) {
        functionName = functionMatch[1];
        currentFunction = line;
        braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        inFunction = true;
      } else if (inFunction) {
        currentFunction += '\n' + line;
        braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        
        if (braceCount === 0) {
          functions.set(functionName, currentFunction);
          inFunction = false;
          currentFunction = '';
          functionName = '';
        }
      }
    }

    return functions;
  }

  private identifyOptimizations(oldFunc?: string, newFunc?: string): string[] {
    if (!oldFunc || !newFunc) return [];

    const optimizations: string[] = [];

    // Check for common optimizations
    if (oldFunc.includes('require(msg.sender == owner)') && 
        newFunc.includes('onlyOwner')) {
      optimizations.push('Replaced manual access control with modifier');
    }

    if (oldFunc.includes('for (uint i = 0; i < array.length; i++)') && 
        newFunc.includes('for (uint i = 0; i < array.length; ++i)')) {
      optimizations.push('Used prefix increment instead of postfix');
    }

    if (!oldFunc.includes('unchecked') && newFunc.includes('unchecked')) {
      optimizations.push('Added unchecked block for arithmetic operations');
    }

    return optimizations;
  }

  private identifyRegressions(oldFunc?: string, newFunc?: string): string[] {
    if (!oldFunc || !newFunc) return [];

    const regressions: string[] = [];

    // Check for common regressions
    if (oldFunc.includes('onlyOwner') && 
        newFunc.includes('require(msg.sender == owner)')) {
      regressions.push('Replaced modifier with manual access control');
    }

    if (oldFunc.includes('unchecked') && !newFunc.includes('unchecked')) {
      regressions.push('Removed unchecked block - potential gas increase');
    }

    if (newFunc.includes('.call(') && !newFunc.includes('require(')) {
      regressions.push('Added external call without return value check');
    }

    return regressions;
  }

  private areFindingsSimilar(finding1: Finding, finding2: Finding): boolean {
    return finding1.ruleId === finding2.ruleId &&
           finding1.location.startLine === finding2.location.startLine &&
           finding1.severity === finding2.severity;
  }

  private calculateRiskScore(findings: Finding[]): number {
    let score = 0;
    for (const finding of findings) {
      switch (finding.severity) {
        case Severity.CRITICAL:
          score += 10;
          break;
        case Severity.HIGH:
          score += 7;
          break;
        case Severity.MEDIUM:
          score += 4;
          break;
        case Severity.LOW:
          score += 2;
          break;
        case Severity.INFO:
          score += 1;
          break;
      }
    }
    return score;
  }

  private generateRecommendations(gasImpact: GasImpactDiff, securityDiff: SecurityDiff): string[] {
    const recommendations: string[] = [];

    if (gasImpact.gasDifference > 1000) {
      recommendations.push(`Consider optimizing ${gasImpact.filePath} - gas usage increased by ${gasImpact.gasDifference.toLocaleString()}`);
    }

    if (securityDiff.newVulnerabilities.length > 0) {
      recommendations.push(`Address ${securityDiff.newVulnerabilities.length} new security vulnerabilities in ${securityDiff.filePath}`);
    }

    if (securityDiff.fixedVulnerabilities.length > 0) {
      recommendations.push(`Good: ${securityDiff.fixedVulnerabilities.length} security vulnerabilities fixed in ${securityDiff.filePath}`);
    }

    for (const func of gasImpact.affectedFunctions) {
      if (func.percentChange > 20) {
        recommendations.push(`Function ${func.functionName} gas usage increased by ${func.percentChange.toFixed(1)}%`);
      }
    }

    return recommendations;
  }

  private determineOverallRiskLevel(
    totalGasImpact: number,
    securityRegressions: number,
    securityImprovements: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (securityRegressions > 0) {
      if (securityRegressions >= 3) return 'critical';
      if (securityRegressions >= 2) return 'high';
      return 'medium';
    }

    if (totalGasImpact > 50000) return 'high';
    if (totalGasImpact > 10000) return 'medium';
    
    return 'low';
  }
}
