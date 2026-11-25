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
  nodeTypeCounts?: Record<string, number>;
}

export class RuleCoverageAnalyzer {
  private totalNodes = 0;
  private registeredNodeIds = new Set<string>();
  private analyzedNodeIds = new Set<string>();
  private uncoveredPatterns = new Set<string>();
  private nodeTypeCounts = new Map<string, number>();

  /**
   * Walk the AST iteratively and count all nodes and node types.
   */
  registerAst(root: AstNode): void {
    if (!root || typeof root !== 'object') {
      return;
    }

    const stack: AstNode[] = [root];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') {
        continue;
      }

      this.totalNodes++;

      if (typeof node.type === 'string' && node.type.length > 0) {
        this.nodeTypeCounts.set(node.type, (this.nodeTypeCounts.get(node.type) ?? 0) + 1);
      }

      if (typeof node.id === 'string' && node.id.length > 0) {
        this.registeredNodeIds.add(node.id);
      }

      if (Array.isArray(node.children)) {
        // Push in reverse so left-to-right traversal order is preserved
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push(node.children[i]);
        }
      }
    }
  }

  /**
   * Mark a registered node as covered by a rule.
   */
  markAnalyzed(nodeId: string): void {
    if (typeof nodeId !== 'string' || nodeId.length === 0) {
      return;
    }

    // If AST nodes were registered with IDs, only count known node IDs
    if (this.registeredNodeIds.size > 0 && !this.registeredNodeIds.has(nodeId)) {
      return;
    }

    this.analyzedNodeIds.add(nodeId);
  }

  /**
   * Record a pattern that was not matched by any rule.
   */
  reportUncovered(pattern: string): void {
    const trimmed = typeof pattern === 'string' ? pattern.trim() : '';
    if (trimmed.length > 0) {
      this.uncoveredPatterns.add(trimmed);
    }
  }

  /**
   * Generate deterministic coverage metrics.
   */
  getMetrics(): CoverageMetrics {
    const rawAnalyzed = this.analyzedNodeIds.size;
    const analyzedNodes =
      this.totalNodes === 0 ? 0 : Math.min(rawAnalyzed, this.totalNodes);

    const coveragePercent =
      this.totalNodes === 0
        ? 100
        : Math.min(100, Math.round((analyzedNodes / this.totalNodes) * 100));

    const sortedTypeCounts: Record<string, number> = {};
    for (const key of [...this.nodeTypeCounts.keys()].sort()) {
      sortedTypeCounts[key] = this.nodeTypeCounts.get(key) ?? 0;
    }

    return {
      totalNodes: this.totalNodes,
      analyzedNodes,
      coveragePercent,
      uncoveredPatterns: [...this.uncoveredPatterns].sort(),
      nodeTypeCounts: sortedTypeCounts,
    };
  }

  /**
   * Reset all tracked coverage state.
   */
  reset(): void {
    this.totalNodes = 0;
    this.registeredNodeIds.clear();
    this.analyzedNodeIds.clear();
    this.uncoveredPatterns.clear();
    this.nodeTypeCounts.clear();
  }
}