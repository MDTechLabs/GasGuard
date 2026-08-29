/**
 * Soroban Contract Pattern Library
 *
 * Maintains a reusable catalog of recognized contract patterns for Soroban
 * contracts. Supports registering patterns with metadata, pattern lookup
 * by name/category/severity, and detection of patterns against contract AST.
 */

import {
  ContractPattern,
  PatternCategory,
  PatternSeverity,
  PatternMatch,
  PatternLookupOptions,
  ASTNodeMatcher,
} from './types';

export class ContractPatternLibrary {
  private patterns: Map<string, ContractPattern> = new Map();

  /**
   * Register a new contract pattern with metadata and detection logic.
   */
  registerPattern(pattern: ContractPattern): void {
    if (this.patterns.has(pattern.id)) {
      throw new Error(`Pattern with id '${pattern.id}' is already registered`);
    }
    this.patterns.set(pattern.id, { ...pattern });
  }

  /**
   * Find a pattern by its unique identifier.
   */
  findPattern(id: string): ContractPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * List all registered patterns, optionally filtered by lookup options.
   */
  listPatterns(options?: PatternLookupOptions): ContractPattern[] {
    let result = Array.from(this.patterns.values());

    if (options) {
      if (options.name) {
        const lowerName = options.name.toLowerCase();
        result = result.filter(
          (p) =>
            p.name.toLowerCase().includes(lowerName) ||
            p.id.toLowerCase().includes(lowerName),
        );
      }
      if (options.category) {
        result = result.filter((p) => p.category === options.category);
      }
      if (options.severity) {
        result = result.filter((p) => p.severity === options.severity);
      }
      if (options.tags && options.tags.length > 0) {
        result = result.filter((p) =>
          options.tags!.some((tag) => p.tags.includes(tag)),
        );
      }
    }

    return result;
  }

  /**
   * Run detection for all registered patterns against a simplified AST.
   * The ast parameter is an array of AST node objects with at least a type property.
   */
  async detectPatterns(ast: Record<string, unknown>[]): Promise<PatternMatch[]> {
    const matches: PatternMatch[] = [];

    for (const pattern of this.patterns.values()) {
      const patternMatches = await this.detectPattern(pattern, ast);
      matches.push(...patternMatches);
    }

    return matches;
  }

  /**
   * Run detection for a single pattern against the AST.
   */
  async detectPattern(
    pattern: ContractPattern,
    ast: Record<string, unknown>[],
  ): Promise<PatternMatch[]> {
    const { detectionLogic } = pattern;
    const matches: PatternMatch[] = [];

    switch (detectionLogic.type) {
      case 'ast-node':
        matches.push(
          ...this.detectByASTNode(
            pattern,
            detectionLogic.matcher as ASTNodeMatcher,
            ast,
          ),
        );
        break;
      case 'semantic':
      case 'regex':
      case 'custom':
        // For semantic, regex, and custom types, we delegate to the handler
        // string stored in the matcher. In a real implementation this would
        // invoke a registered handler function. Here we return matches with
        // the metadata indicating the handler to use.
        matches.push({
          patternId: pattern.id,
          patternName: pattern.name,
          category: pattern.category,
          severity: pattern.severity,
          location: { startLine: 0, endLine: 0 },
          confidence: 0,
          metadata: {
            detectionType: detectionLogic.type,
            handler: String(detectionLogic.matcher),
          },
        });
        break;
      default:
        break;
    }

    return matches;
  }

  /**
   * Remove a registered pattern by id.
   */
  unregisterPattern(id: string): boolean {
    return this.patterns.delete(id);
  }

  /**
   * Return the total number of registered patterns.
   */
  get patternCount(): number {
    return this.patterns.size;
  }

  /**
   * Detect pattern matches by walking AST nodes and matching against
   * an ASTNodeMatcher definition.
   */
  private detectByASTNode(
    pattern: ContractPattern,
    matcher: ASTNodeMatcher,
    ast: Record<string, unknown>[],
  ): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const node of ast) {
      if (this.nodeMatchesMatcher(node, matcher)) {
        matches.push({
          patternId: pattern.id,
          patternName: pattern.name,
          category: pattern.category,
          severity: pattern.severity,
          location: {
            startLine: (node.startLine as number) ?? 0,
            endLine: (node.endLine as number) ?? 0,
            file: (node.file as string) ?? undefined,
          },
          confidence: this.calculateConfidence(node, matcher),
          context: node.context as string | undefined,
          metadata: {
            matchedNodeType: node.type,
          },
        });
      }

      // Recursively check child nodes
      if (matcher.children) {
        const children = this.extractChildren(node);
        for (const childMatcher of matcher.children) {
          matches.push(
            ...this.detectByASTNode(pattern, childMatcher, children),
          );
        }
      }
    }

    return matches;
  }

  /**
   * Check if a single AST node matches the given ASTNodeMatcher.
   */
  private nodeMatchesMatcher(
    node: Record<string, unknown>,
    matcher: ASTNodeMatcher,
  ): boolean {
    if (node.type !== matcher.nodeType) {
      return false;
    }

    if (matcher.properties) {
      for (const [key, value] of Object.entries(matcher.properties)) {
        if (node[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Calculate confidence score for a match based on how well the node
   * satisfies the matcher properties.
   */
  private calculateConfidence(
    node: Record<string, unknown>,
    matcher: ASTNodeMatcher,
  ): number {
    if (!matcher.properties || Object.keys(matcher.properties).length === 0) {
      return 0.5;
    }

    const totalProps = Object.keys(matcher.properties).length;
    let matchedProps = 0;

    for (const key of Object.keys(matcher.properties)) {
      if (node[key] === matcher.properties[key]) {
        matchedProps++;
      }
    }

    return matchedProps / totalProps;
  }

  /**
   * Extract child nodes from an AST node, if any.
   */
  private extractChildren(
    node: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const children: Record<string, unknown>[] = [];

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null && 'type' in item) {
            children.push(item as Record<string, unknown>);
          }
        }
      }
    }

    return children;
  }
}
