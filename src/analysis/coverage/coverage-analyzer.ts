/**
 * Rule Coverage Analyzer (#235)
 * Tracks analyzed AST nodes vs total nodes and reports uncovered patterns.
 */

export interface AstNode {
  type: string;
  id?: string;
  children?: AstNode[];
}

export interface CoverageMetrics {
  totalNodes: number;
  analyzedNodes: number;
  coveragePercent: number;
  uncoveredPatterns: string[];
}

export class RuleCoverageAnalyzer {
  private analyzedNodeIds = new Set<string>();
  private totalNodes = 0;
  private uncoveredPatterns: string[] = [];

  /**
   * Walk the AST and count all nodes.
   */
  registerAst(node: AstNode): void {
    this.totalNodes++;
    if (node.children) {
      for (const child of node.children) {
        this.registerAst(child);
      }
    }
  }

  /**
   * Mark a node as covered by a rule.
   */
  markAnalyzed(nodeId: string): void {
    this.analyzedNodeIds.add(nodeId);
  }

  /**
   * Record a pattern that was not matched by any rule.
   */
  reportUncovered(pattern: string): void {
    if (!this.uncoveredPatterns.includes(pattern)) {
      this.uncoveredPatterns.push(pattern);
    }
  }

  /**
   * Generate coverage metrics.
   */
  getMetrics(): CoverageMetrics {
    const analyzedNodes = this.analyzedNodeIds.size;
    const coveragePercent =
      this.totalNodes === 0
        ? 100
        : Math.round((analyzedNodes / this.totalNodes) * 100);

    return {
      totalNodes: this.totalNodes,
      analyzedNodes,
      coveragePercent,
      uncoveredPatterns: [...this.uncoveredPatterns],
    };
  }

  reset(): void {
    this.analyzedNodeIds.clear();
    this.totalNodes = 0;
    this.uncoveredPatterns = [];
  }
}
