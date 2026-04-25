/**
 * Example Plugin Structure Template
 * Shows the recommended way to organize a GasGuard plugin
 */

// ============================================================================
// 1. Types and Interfaces
// ============================================================================

export interface AnalysisResult {
  violations: Violation[];
  metadata: Record<string, any>;
  timestamp: Date;
}

export interface Violation {
  ruleId: string;
  ruleName: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  location: {
    file?: string;
    line?: number;
    column?: number;
  };
  message: string;
  suggestion: string;
}

// ============================================================================
// 2. Rule Interface
// ============================================================================

export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly languages: string[];

  analyze(code: string): Violation[];
}

// ============================================================================
// 3. Rule Implementation Examples
// ============================================================================

/**
 * Example: Gas Optimization Rule
 */
export class UnoptimizedLoopRule implements Rule {
  readonly id = 'unoptimized-loop';
  readonly name = 'Unoptimized Loop';
  readonly description = 'Detects loops that read array length in each iteration';
  readonly languages = ['solidity', 'rust'];

  analyze(code: string): Violation[] {
    const violations: Violation[] = [];
    const lines = code.split('\n');

    // Pattern: for (... < array.length ...) without caching
    const loopPattern =
      /for\s*\([^)]*<\s*(\w+)\.length[^)]*\)/g;

    lines.forEach((line, lineNum) => {
      let match;
      while ((match = loopPattern.exec(line)) !== null) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: 'high',
          location: {
            line: lineNum + 1,
            column: match.index,
          },
          message: `Loop reads ${match[1]}.length in each iteration`,
          suggestion: `Cache array length: \`uint256 length = ${match[1]}.length;\` before loop`,
        });
      }
    });

    return violations;
  }
}

/**
 * Example: Security Rule
 */
export class MissingReentrancyGuardRule implements Rule {
  readonly id = 'missing-reentrancy-guard';
  readonly name = 'Missing Reentrancy Guard';
  readonly description =
    'Detects external calls without reentrancy protection';
  readonly languages = ['solidity'];

  analyze(code: string): Violation[] {
    const violations: Violation[] = [];
    const hasGuard = code.includes('nonReentrant');
    const hasExternalCall = /\.call|\.delegatecall|\.transfer/.test(code);

    if (hasExternalCall && !hasGuard) {
      violations.push({
        ruleId: this.id,
        ruleName: this.name,
        severity: 'critical',
        location: { line: 1 },
        message: 'External calls detected without reentrancy guard',
        suggestion: 'Add @nonReentrant modifier to functions making external calls',
      });
    }

    return violations;
  }
}

/**
 * Example: Code Quality Rule
 */
export class NamingConventionRule implements Rule {
  readonly id = 'naming-convention';
  readonly name = 'Naming Convention';
  readonly description = 'Checks adherence to naming conventions';
  readonly languages = ['solidity', 'rust'];

  analyze(code: string): Violation[] {
    const violations: Violation[] = [];
    const lines = code.split('\n');

    // Check for camelCase violations
    const nonStandardNames =
      /(?:function|let|const|var)\s+([a-z]+_[a-z]+)/g;

    lines.forEach((line, lineNum) => {
      let match;
      while ((match = nonStandardNames.exec(line)) !== null) {
        violations.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: 'warning',
          location: {
            line: lineNum + 1,
            column: match.index,
          },
          message: `Non-standard naming: '${match[1]}' should use camelCase`,
          suggestion: `Rename to: '${
            match[1].replace(/_(.)/g, (g) => g[1].toUpperCase())
          }'`,
        });
      }
    });

    return violations;
  }
}

// ============================================================================
// 4. Plugin Registry
// ============================================================================

export class PluginRegistry {
  private rules: Map<string, Rule> = new Map();

  registerRule(rule: Rule): void {
    if (this.rules.has(rule.id)) {
      throw new Error(`Rule ${rule.id} already registered`);
    }
    this.rules.set(rule.id, rule);
  }

  registerRules(rules: Rule[]): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  getRule(id: string): Rule | undefined {
    return this.rules.get(id);
  }

  getRulesByLanguage(language: string): Rule[] {
    return Array.from(this.rules.values()).filter((rule) =>
      rule.languages.includes(language),
    );
  }

  getAllRules(): Rule[] {
    return Array.from(this.rules.values());
  }

  analyzeCode(code: string, language: string): AnalysisResult {
    const rules = this.getRulesByLanguage(language);
    const violations: Violation[] = [];

    for (const rule of rules) {
      try {
        violations.push(...rule.analyze(code));
      } catch (error) {
        console.error(`Error analyzing with ${rule.id}:`, error);
      }
    }

    return {
      violations,
      metadata: {
        rulesApplied: rules.length,
        language,
      },
      timestamp: new Date(),
    };
  }
}

// ============================================================================
// 5. Plugin Factory
// ============================================================================

export function createRegistry(): PluginRegistry {
  const registry = new PluginRegistry();

  // Register all rules
  registry.registerRules([
    new UnoptimizedLoopRule(),
    new MissingReentrancyGuardRule(),
    new NamingConventionRule(),
  ]);

  return registry;
}

// ============================================================================
// 6. Plugin Configuration
// ============================================================================

export interface PluginConfig {
  enabledRules?: string[];
  disabledRules?: string[];
  ruleSeverityThreshold?: 'info' | 'warning' | 'error' | 'critical';
  customOptions?: Record<string, any>;
}

export class ConfigurableRegistry extends PluginRegistry {
  config: PluginConfig;

  constructor(config: PluginConfig = {}) {
    super();
    this.config = config;
  }

  analyzeCode(code: string, language: string): AnalysisResult {
    let result = super.analyzeCode(code, language);

    // Filter violations based on configuration
    if (this.config.enabledRules) {
      result.violations = result.violations.filter((v) =>
        this.config.enabledRules!.includes(v.ruleId),
      );
    }

    if (this.config.disabledRules) {
      result.violations = result.violations.filter(
        (v) => !this.config.disabledRules!.includes(v.ruleId),
      );
    }

    if (this.config.ruleSeverityThreshold) {
      const severityLevels = ['info', 'warning', 'error', 'critical'];
      const thresholdIndex = severityLevels.indexOf(
        this.config.ruleSeverityThreshold,
      );
      result.violations = result.violations.filter(
        (v) => severityLevels.indexOf(v.severity) >= thresholdIndex,
      );
    }

    return result;
  }
}

// ============================================================================
// 7. Usage Example
// ============================================================================

export async function exampleUsage(): Promise<void> {
  // Create registry with rules
  const registry = createRegistry();

  // Example Solidity code
  const solidityCode = `
    contract Storage {
      uint256[] public items;

      function process() public {
        for (uint i = 0; i < items.length; i++) {
          // Process each item
        }
      }

      function withdraw() public {
        msg.sender.call{value: address(this).balance}("");
      }
    }
  `;

  // Analyze code
  const result = registry.analyzeCode(solidityCode, 'solidity');

  console.log(`Found ${result.violations.length} violations`);
  for (const violation of result.violations) {
    console.log(`  [${violation.severity}] ${violation.ruleName}`);
    console.log(`    ${violation.message}`);
    console.log(`    Fix: ${violation.suggestion}`);
  }

  // Example with configuration
  const configRegistry = new ConfigurableRegistry({
    enabledRules: ['unoptimized-loop', 'missing-reentrancy-guard'],
    ruleSeverityThreshold: 'warning',
  });

  const filteredResult = configRegistry.analyzeCode(solidityCode, 'solidity');
  console.log(`\nFiltered result: ${filteredResult.violations.length} violations`);
}

// Run if executed directly
if (typeof module !== 'undefined' && require.main === module) {
  exampleUsage().catch(console.error);
}
