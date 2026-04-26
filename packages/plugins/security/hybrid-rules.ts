import { Finding, Rule, Severity } from '@engine/core';

export interface HybridIssue extends Finding {
  gasImpact: number;
  gasOptimization?: string;
  securityCategory: string;
}

export interface HybridRuleResult {
  ruleName: string;
  securityIssues: HybridIssue[];
  gasIssues: GasIssue[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export class HybridRuleEngine {
  private rules: HybridRule[] = [];

  constructor() {
    this.initializeRules();
  }

  private initializeRules() {
    this.rules = [
      new UncheckedExternalCallRule(),
      new IntegerOverflowRule(),
      new ReentrancyGasRule(),
      new DoSVulnerabilityRule(),
      new AccessControlGasRule()
    ];
  }

  async analyzeCode(ast: any, sourceCode: string): Promise<HybridRuleResult[]> {
    const results: HybridRuleResult[] = [];
    
    for (const rule of this.rules) {
      const result = await rule.check(ast, sourceCode);
      if (result.securityIssues.length > 0 || result.gasIssues.length > 0) {
        results.push(result);
      }
    }

    return results;
  }

  getRiskScore(issues: HybridIssue[]): number {
    let score = 0;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score += 10;
          break;
        case 'high':
          score += 7;
          break;
        case 'medium':
          score += 4;
          break;
        case 'low':
          score += 1;
          break;
      }
      score += issue.gasImpact / 1000; // Add gas impact component
    }
    return Math.min(score, 100);
  }
}

abstract class HybridRule {
  abstract name: string;
  abstract description: string;

  abstract check(ast: any, sourceCode: string): Promise<HybridRuleResult>;

  protected createHybridIssue(
    title: string,
    description: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    line: number,
    gasImpact: number,
    gasOptimization?: string
  ): HybridIssue {
    return {
      ruleId: this.name,
      message: description,
      severity: severity as Severity,
      location: {
        file: '',
        startLine: line,
        endLine: line
      },
      estimatedGasSavings: gasImpact,
      suggestedFix: {
        description: gasOptimization || 'Review and fix this security vulnerability'
      },
      gasImpact,
      gasOptimization,
      securityCategory: 'security'
    };
  }
}

class UncheckedExternalCallRule extends HybridRule {
  name = 'Unchecked External Call';
  description = 'Detects unchecked external calls that may lead to failed transactions and wasted gas';

  async check(ast: any, sourceCode: string): Promise<HybridRuleResult> {
    const issues: HybridIssue[] = [];
    const gasIssues: GasIssue[] = [];

    // Pattern matching for unchecked calls
    const uncheckedCallPattern = /\.(call|delegatecall|staticcall|transfer|send)\([^)]*\)/g;
    let match;
    
    while ((match = uncheckedCallPattern.exec(sourceCode)) !== null) {
      const line = sourceCode.substring(0, match.index).split('\n').length;
      
      issues.push(this.createHybridIssue(
        'Unchecked External Call',
        'External call return value is not checked, which can lead to silent failures and wasted gas',
        'high',
        line,
        21000, // Base gas cost for failed call
        'Add require() or check return value to handle failures gracefully'
      ));

      gasIssues.push({
        title: 'Potential Gas Waste from Unchecked Call',
        description: 'Failed external calls still consume gas',
        line,
        gasAmount: 21000,
        optimization: 'Check return values before proceeding'
      });
    }

    return {
      ruleName: this.name,
      securityIssues: issues,
      gasIssues,
      riskLevel: issues.length > 0 ? 'high' : 'low'
    };
  }
}

class IntegerOverflowRule extends HybridRule {
  name = 'Integer Overflow/Underflow';
  description = 'Detects potential integer overflow/underflow that can cause security issues and unexpected gas consumption';

  async check(ast: any, sourceCode: string): Promise<HybridRuleResult> {
    const issues: HybridIssue[] = [];
    const gasIssues: GasIssue[] = [];

    // Look for arithmetic operations without safe math
    const unsafeMathPattern = /(?:\w+\s*[\+\-\*\/]\s*\w+|\w+\s*\+=\s*\w+|\w+\s*-=\s*\w+)/g;
    let match;
    
    while ((match = unsafeMathPattern.exec(sourceCode)) !== null) {
      const line = sourceCode.substring(0, match.index).split('\n').length;
      
      if (!sourceCode.includes('SafeMath') && !sourceCode.includes('using SafeMath')) {
        issues.push(this.createHybridIssue(
          'Potential Integer Overflow',
          'Arithmetic operation without overflow protection can lead to unexpected behavior',
          'medium',
          line,
          5000, // Potential gas from unexpected behavior
          'Use SafeMath library or Solidity 0.8+ built-in overflow protection'
        ));

        gasIssues.push({
          title: 'Gas Inefficiency from Unsafe Math',
          description: 'Overflow conditions can cause transaction reversals and gas waste',
          line,
          gasAmount: 5000,
          optimization: 'Implement overflow checks or use SafeMath'
        });
      }
    }

    return {
      ruleName: this.name,
      securityIssues: issues,
      gasIssues,
      riskLevel: issues.length > 0 ? 'medium' : 'low'
    };
  }
}

class ReentrancyGasRule extends HybridRule {
  name = 'Reentrancy Gas Risk';
  description = 'Detects reentrancy vulnerabilities that can lead to gas drain attacks';

  async check(ast: any, sourceCode: string): Promise<HybridRuleResult> {
    const issues: HybridIssue[] = [];
    const gasIssues: GasIssue[] = [];

    // Look for external calls before state changes
    const callBeforeStateChangePattern = /(\w+\.(call|transfer|send)\([^)]*\)[\s\S]*?)(\w+\s*=)/g;
    let match;
    
    while ((match = callBeforeStateChangePattern.exec(sourceCode)) !== null) {
      const line = sourceCode.substring(0, match.index).split('\n').length;
      
      issues.push(this.createHybridIssue(
        'Reentrancy Vulnerability',
        'External call before state change creates reentrancy risk',
        'critical',
        line,
        50000, // Potential gas drain from reentrancy attack
        'Implement checks-effects-interactions pattern'
      ));

      gasIssues.push({
        title: 'Gas Drain Risk from Reentrancy',
        description: 'Reentrancy attacks can drain gas through recursive calls',
        line,
        gasAmount: 50000,
        optimization: 'Use reentrancy guards and proper state update order'
      });
    }

    return {
      ruleName: this.name,
      securityIssues: issues,
      gasIssues,
      riskLevel: issues.length > 0 ? 'critical' : 'low'
    };
  }
}

class DoSVulnerabilityRule extends HybridRule {
  name = 'Denial of Service Gas';
  description = 'Detects patterns that can lead to gas-based DoS attacks';

  async check(ast: any, sourceCode: string): Promise<HybridRuleResult> {
    const issues: HybridIssue[] = [];
    const gasIssues: GasIssue[] = [];

    // Look for unbounded loops or operations
    const unboundedLoopPattern = /for\s*\(\s*.*\s*in\s*.*\s*\)/g;
    let match;
    
    while ((match = unboundedLoopPattern.exec(sourceCode)) !== null) {
      const line = sourceCode.substring(0, match.index).split('\n').length;
      
      issues.push(this.createHybridIssue(
        'Potential DoS via Unbounded Loop',
        'Unbounded loops can cause gas exhaustion attacks',
        'high',
        line,
        100000, // Potential gas consumption
        'Add bounds checking or limit iteration count'
      ));

      gasIssues.push({
        title: 'High Gas Consumption Risk',
        description: 'Unbounded operations can lead to gas exhaustion',
        line,
        gasAmount: 100000,
        optimization: 'Implement proper bounds and limits'
      });
    }

    return {
      ruleName: this.name,
      securityIssues: issues,
      gasIssues,
      riskLevel: issues.length > 0 ? 'high' : 'low'
    };
  }
}

class AccessControlGasRule extends HybridRule {
  name = 'Access Control Gas Efficiency';
  description = 'Detects access control issues and their gas implications';

  async check(ast: any, sourceCode: string): Promise<HybridRuleResult> {
    const issues: HybridIssue[] = [];
    const gasIssues: GasIssue[] = [];

    // Look for inefficient access control patterns
    const inefficientAccessPattern = /require\s*\(\s*msg\.sender\s*==\s*owner/g;
    let match;
    
    while ((match = inefficientAccessPattern.exec(sourceCode)) !== null) {
      const line = sourceCode.substring(0, match.index).split('\n').length;
      
      issues.push(this.createHybridIssue(
        'Inefficient Access Control',
        'Direct owner comparison is less gas-efficient and potentially insecure',
        'medium',
        line,
        2000, // Extra gas cost
        'Use modifiers or role-based access control for better gas efficiency'
      ));

      gasIssues.push({
        title: 'Inefficient Access Control Check',
        description: 'Direct comparison costs more gas than optimized patterns',
        line,
        gasAmount: 2000,
        optimization: 'Use modifiers or cached owner address'
      });
    }

    return {
      ruleName: this.name,
      securityIssues: issues,
      gasIssues,
      riskLevel: issues.length > 0 ? 'medium' : 'low'
    };
  }
}

interface GasIssue {
  title: string;
  description: string;
  line: number;
  gasAmount: number;
  optimization: string;
}
