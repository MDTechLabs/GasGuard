import { KBRule, SearchOptions } from './types';
import { RULES } from './rules-db';

export class StellarKnowledgeBase {
  private rules: Map<string, KBRule> = new Map();

  constructor() {
    for (const rule of RULES) {
      this.rules.set(rule.id, rule);
    }
  }

  /**
   * Retrieves a rule by its ID.
   */
  getRule(id: string): KBRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Returns all rules in the knowledge base.
   */
  getAllRules(): KBRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Searches the knowledge base for rules matching a query and search options.
   * Searches across rule ID, name, description, explanation, and tags.
   */
  search(query: string, options?: SearchOptions): KBRule[] {
    const sanitizedQuery = query.trim().toLowerCase();
    let results = this.getAllRules();

    if (sanitizedQuery) {
      results = results.filter((rule) => {
        return (
          rule.id.toLowerCase().includes(sanitizedQuery) ||
          rule.name.toLowerCase().includes(sanitizedQuery) ||
          rule.description.toLowerCase().includes(sanitizedQuery) ||
          rule.explanation.toLowerCase().includes(sanitizedQuery) ||
          rule.tags.some((tag) => tag.toLowerCase().includes(sanitizedQuery))
        );
      });
    }

    if (options) {
      if (options.category) {
        const targetCategory = options.category.toLowerCase();
        results = results.filter(
          (rule) => rule.category.toLowerCase() === targetCategory
        );
      }

      if (options.severity) {
        const targetSeverity = options.severity.toLowerCase();
        results = results.filter(
          (rule) => rule.severity.toLowerCase() === targetSeverity
        );
      }

      if (options.limit !== undefined && options.limit >= 0) {
        results = results.slice(0, options.limit);
      }
    }

    return results;
  }

  /**
   * Enriches a finding with documentation links and remediation information
   * from the knowledge base, based on its ruleId.
   */
  linkFinding<
    T extends {
      ruleId: string;
      suggestedFix?: {
        description?: string;
        codeSnippet?: string;
        documentationUrl?: string;
      };
    }
  >(finding: T): T {
    const rule = this.getRule(finding.ruleId);
    if (!rule) {
      return finding;
    }

    const updatedFinding = { ...finding };
    
    // Ensure suggestedFix object exists
    if (!updatedFinding.suggestedFix) {
      updatedFinding.suggestedFix = {};
    } else {
      updatedFinding.suggestedFix = { ...updatedFinding.suggestedFix };
    }

    // Link finding to documentation url if not already present
    if (!updatedFinding.suggestedFix.documentationUrl) {
      updatedFinding.suggestedFix.documentationUrl = rule.documentationUrl;
    }

    // Add description from the rule if missing
    if (!updatedFinding.suggestedFix.description) {
      updatedFinding.suggestedFix.description = `Remediation suggestion: ${rule.description}`;
    }

    // Add code snippet from the rule if missing
    if (!updatedFinding.suggestedFix.codeSnippet && rule.remediation) {
      updatedFinding.suggestedFix.codeSnippet = rule.remediation;
    }

    return updatedFinding;
  }
}
export const stellarKB = new StellarKnowledgeBase();
