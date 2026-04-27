/**
 * Smart Rule Recommendation Engine (#248)
 *
 * Detects project language/type and suggests relevant rule sets.
 */

export type ProjectLanguage = 'solidity' | 'rust' | 'vyper' | 'typescript' | 'unknown';

export interface RuleSet {
  id: string;
  name: string;
  language: ProjectLanguage;
  rules: string[];
  description: string;
}

export interface RecommendationContext {
  files: string[]; // file paths in the project
  configKeys?: string[]; // keys from package.json / Cargo.toml etc.
}

export interface Recommendation {
  language: ProjectLanguage;
  ruleSets: RuleSet[];
  reason: string;
}

const RULE_SETS: RuleSet[] = [
  {
    id: 'solidity-core',
    name: 'Solidity Core',
    language: 'solidity',
    rules: ['reentrancy', 'unchecked-send', 'integer-overflow', 'gas-limit-loops'],
    description: 'Essential rules for Solidity smart contracts',
  },
  {
    id: 'soroban-core',
    name: 'Soroban / Rust Core',
    language: 'rust',
    rules: ['storage-efficiency', 'cpu-budget', 'ledger-limits', 'unused-state'],
    description: 'Optimization rules for Soroban (Stellar) contracts',
  },
  {
    id: 'vyper-core',
    name: 'Vyper Core',
    language: 'vyper',
    rules: ['redundant-external-calls', 'storage-patterns'],
    description: 'Gas optimization rules for Vyper contracts',
  },
  {
    id: 'typescript-analysis',
    name: 'TypeScript Analysis',
    language: 'typescript',
    rules: ['async-patterns', 'type-safety'],
    description: 'Static analysis rules for TypeScript projects',
  },
];

export class RuleRecommendationEngine {
  private customRuleSets: RuleSet[] = [];

  registerRuleSet(ruleSet: RuleSet): void {
    this.customRuleSets.push(ruleSet);
  }

  /**
   * Detect the primary language from file extensions.
   */
  detectLanguage(files: string[]): ProjectLanguage {
    const counts: Record<ProjectLanguage, number> = {
      solidity: 0, rust: 0, vyper: 0, typescript: 0, unknown: 0,
    };

    for (const f of files) {
      if (f.endsWith('.sol')) counts.solidity++;
      else if (f.endsWith('.rs')) counts.rust++;
      else if (f.endsWith('.vy')) counts.vyper++;
      else if (f.endsWith('.ts') || f.endsWith('.tsx')) counts.typescript++;
    }

    const sorted = (Object.entries(counts) as [ProjectLanguage, number][])
      .filter(([lang]) => lang !== 'unknown')
      .sort(([, a], [, b]) => b - a);

    return sorted[0]?.[1] > 0 ? sorted[0][0] : 'unknown';
  }

  /**
   * Recommend rule sets based on project context.
   */
  recommend(ctx: RecommendationContext): Recommendation {
    const language = this.detectLanguage(ctx.files);
    const allSets = [...RULE_SETS, ...this.customRuleSets];
    const ruleSets = allSets.filter(rs => rs.language === language);

    return {
      language,
      ruleSets,
      reason: language === 'unknown'
        ? 'Could not detect project language. Please configure rules manually.'
        : `Detected ${language} project. Recommended ${ruleSets.length} rule set(s).`,
    };
  }
}
