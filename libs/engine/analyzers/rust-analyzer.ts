import {
  Analyzer,
  BaseAnalyzer,
  Language,
  Rule,
  AnalysisResult,
  AnalyzerConfig,
  Finding,
  Severity,
} from '../core/analyzer-interface';


export class RustAnalyzer extends BaseAnalyzer implements Analyzer {
  private rules: Rule[] = [
    {
      id: 'rust-001',
      name: 'Inefficient String Concatenation',
      description: 'Detects inefficient string concatenation that could use String::with_capacity',
      severity: Severity.MEDIUM,
      category: 'gas-optimization',
      enabled: true,
      tags: ['strings', 'memory', 'performance'],
      documentationUrl: 'https://docs.gasguard.dev/rules/rust-001',
      estimatedGasImpact: {
        min: 50,
        max: 500,
        typical: 150,
      },
    },
    {
      id: 'rust-002',
      name: 'Unnecessary Clone',
      description: 'Detects unnecessary .clone() calls that increase resource usage',
      severity: Severity.HIGH,
      category: 'gas-optimization',
      enabled: true,
      tags: ['memory', 'clone', 'performance'],
      documentationUrl: 'https://docs.gasguard.dev/rules/rust-002',
      estimatedGasImpact: {
        min: 100,
        max: 2000,
        typical: 500,
      },
    },
    {
      id: 'rust-003',
      name: 'Vec allocation without capacity',
      description: 'Vec::new() without with_capacity can cause multiple reallocations',
      severity: Severity.MEDIUM,
      category: 'gas-optimization',
      enabled: true,
      tags: ['collections', 'memory', 'performance'],
      documentationUrl: 'https://docs.gasguard.dev/rules/rust-003',
      estimatedGasImpact: {
        min: 200,
        max: 1500,
        typical: 600,
      },
    },
    {
      id: 'soroban-001',
      name: 'Inefficient Storage Access',
      description: 'Multiple storage reads for the same key in Soroban contracts',
      severity: Severity.HIGH,
      category: 'gas-optimization',
      enabled: true,
      tags: ['soroban', 'storage', 'ledger'],
      documentationUrl: 'https://docs.gasguard.dev/rules/soroban-001',
      estimatedGasImpact: {
        min: 500,
        max: 5000,
        typical: 2000,
      },
    },
    {
      id: 'soroban-002',
      name: 'Unbounded Loop in Contract',
      description: 'Loop without clear bounds can cause CPU limit exhaustion',
      severity: Severity.CRITICAL,
      category: 'security',
      enabled: true,
      tags: ['soroban', 'loops', 'cpu-limits'],
      documentationUrl: 'https://docs.gasguard.dev/rules/soroban-002',
      estimatedGasImpact: {
        min: 1000,
        max: 10000,
        typical: 5000,
      },
    },
  ];

  getName(): string {
    return 'RustAnalyzer';
  }

  getVersion(): string {
    return '1.0.0';
  }

  supportsLanguage(language: Language | string): boolean {
    return language === Language.RUST || language === Language.SOROBAN || language === 'rust' || language === 'rs' || language === 'soroban';
  }

  getSupportedLanguages(): Language[] {
    return [Language.RUST, Language.SOROBAN];
  }

  getRules(): Rule[] {
    return this.rules;
  }

  async analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const findings: Finding[] = [];
    const errors: Array<{ file: string; message: string; error?: Error }> = [];

    // Ensure analyzer is initialized
    if (!this.initialized) {
      await this.initialize(config);
    }

    // Check if file should be analyzed
    if (!this.shouldAnalyzeFile(filePath, config)) {
      return {
        findings: [],
        filesAnalyzed: 0,
        analysisTime: Date.now() - startTime,
        analyzerVersion: this.getVersion(),
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      };
    }

    try {
      // Determine if this is a Soroban contract
      const isSorobanContract = this.isSorobanContract(code);

      // Rule: rust-001 - Inefficient string concatenation
      if (this.isRuleEnabled('rust-001', config)) {
        const inefficientStrings = this.detectInefficientStringOps(code);
        findings.push(...inefficientStrings.map(location => ({
          ruleId: 'rust-001',
          message: 'Inefficient string concatenation. Consider using String::with_capacity',
          severity: this.getRuleSeverity('rust-001', config),
          location: {
            file: filePath,
            ...location,
          },
          estimatedGasSavings: 150,
          suggestedFix: {
            description: 'Pre-allocate string capacity to avoid reallocations',
            codeSnippet: 'let mut result = String::with_capacity(estimated_size);\nresult.push_str(&str1);\nresult.push_str(&str2);',
            documentationUrl: 'https://docs.gasguard.dev/rules/rust-001',
          },
        })));
      }

      // Rule: rust-002 - Unnecessary clone
      if (this.isRuleEnabled('rust-002', config)) {
        const unnecessaryClones = this.detectUnnecessaryClones(code);
        findings.push(...unnecessaryClones.map(location => ({
          ruleId: 'rust-002',
          message: 'Unnecessary .clone() detected. Consider using references',
          severity: this.getRuleSeverity('rust-002', config),
          location: {
            file: filePath,
            ...location,
          },
          estimatedGasSavings: 500,
          suggestedFix: {
            description: 'Use references (&) instead of cloning when possible',
            documentationUrl: 'https://docs.gasguard.dev/rules/rust-002',
          },
        })));
      }

      // Rule: rust-003 - Vec without capacity
      if (this.isRuleEnabled('rust-003', config)) {
        const vecWithoutCapacity = this.detectVecWithoutCapacity(code);
        findings.push(...vecWithoutCapacity.map(location => ({
          ruleId: 'rust-003',
          message: 'Vec created without capacity. Consider using Vec::with_capacity',
          severity: this.getRuleSeverity('rust-003', config),
          location: {
            file: filePath,
            ...location,
          },
          estimatedGasSavings: 600,
          suggestedFix: {
            description: 'Pre-allocate Vec capacity to avoid reallocations',
            codeSnippet: 'let mut vec = Vec::with_capacity(expected_size);',
            documentationUrl: 'https://docs.gasguard.dev/rules/rust-003',
          },
        })));
      }


      if (isSorobanContract) {
        // Rule: soroban-001 - Inefficient storage access
        if (this.isRuleEnabled('soroban-001', config)) {
          const inefficientStorage = this.detectInefficientStorageAccess(code);
          findings.push(...inefficientStorage.map(location => ({
            ruleId: 'soroban-001',
            message: 'Multiple storage reads for the same key. Cache the value',
            severity: this.getRuleSeverity('soroban-001', config),
            location: {
              file: filePath,
              ...location,
            },
            estimatedGasSavings: 2000,
            suggestedFix: {
              description: 'Cache storage value in a local variable',
              codeSnippet: 'let cached_value = env.storage().instance().get(&key);\n// Use cached_value multiple times',
              documentationUrl: 'https://docs.gasguard.dev/rules/soroban-001',
            },
          })));
        }

        // Rule: soroban-002 - Unbounded loops
        if (this.isRuleEnabled('soroban-002', config)) {
          const unboundedLoops = this.detectUnboundedLoops(code);
          findings.push(...unboundedLoops.map(location => ({
            ruleId: 'soroban-002',
            message: 'Unbounded loop detected. This can cause CPU limit exhaustion',
            severity: this.getRuleSeverity('soroban-002', config),
            location: {
              file: filePath,
              ...location,
            },
            estimatedGasSavings: 5000,
            suggestedFix: {
              description: 'Add clear bounds to loops or use pagination',
              documentationUrl: 'https://docs.gasguard.dev/rules/soroban-002',
            },
          })));
        }
      }
    } catch (error) {
      errors.push({
        file: filePath,
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error : undefined,
      });
    }

    const analysisTime = Date.now() - startTime;

    return {
      findings,
      filesAnalyzed: 1,
      analysisTime,
      analyzerVersion: this.getVersion(),
      summary: this.calculateSummary(findings),
      totalEstimatedGasSavings: this.calculateTotalGasSavings(findings),
      errors: errors.length > 0 ? errors : undefined,
    };
  }


  private isSorobanContract(code: string): boolean {
    return code.includes('soroban_sdk') || 
           code.includes('#[contract]') || 
           code.includes('#[contractimpl]') || 
           code.includes('#[contracttype]');
  }


  private isRuleEnabled(ruleId: string, config?: AnalyzerConfig): boolean {
    const cfg = config || this.config;

    if (!cfg.rules || !(ruleId in cfg.rules)) {
      const rule = this.getRule(ruleId);
      return rule?.enabled ?? true;
    }

    const ruleConfig = cfg.rules[ruleId];

    if (typeof ruleConfig === 'boolean') {
      return ruleConfig;
    }

    return (typeof ruleConfig === 'object' && ruleConfig?.enabled) ?? true;
  }


  private getRuleSeverity(ruleId: string, config?: AnalyzerConfig): Severity {
    const cfg = config || this.config;
    const rule = this.getRule(ruleId);

    if (!rule) {
      return Severity.MEDIUM;
    }

    if (cfg.rules && ruleId in cfg.rules) {
      const ruleConfig = cfg.rules[ruleId];
      if (typeof ruleConfig === 'object' && ruleConfig.severity) {
        return ruleConfig.severity;
      }
    }

    return rule.severity;
  }

  private detectInefficientStringOps(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      if (line.includes('String::new()') && !line.includes('with_capacity')) {
        let hasPushStr = false;
        for (let i = index + 1; i < Math.min(index + 5, lines.length); i++) {
          const nextLine = lines[i];
          if (nextLine && nextLine.includes('push_str')) {
            hasPushStr = true;
            break;
          }
        }

        if (hasPushStr) {
          findings.push({
            startLine: index + 1,
            endLine: index + 1,
          });
        }
      }
    });

    return findings;
  }


  private detectUnnecessaryClones(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    
    lines.forEach((line, index) => {
      if (line.includes('.clone()') && !line.includes('//')) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });

    return findings;
  }


  private detectVecWithoutCapacity(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      if (line.includes('Vec::new()') && !line.includes('with_capacity')) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });

    return findings;
  }


  private detectInefficientStorageAccess(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    // Track storage.get() calls with the same key
    const storageAccess = new Map<string, number[]>();

    lines.forEach((line, index) => {
      const match = line.match(/storage\(\)\.(?:instance|persistent|temporary)\(\)\.get\(&(\w+)\)/);
      if (match) {
        const key = match[1];
        if (typeof key === 'string') {
          if (!storageAccess.has(key)) {
            storageAccess.set(key, []);
          }
          storageAccess.get(key)!.push(index + 1);
        }
      }
    });

    // Flag keys accessed multiple times
    for (const [, lineNumbers] of storageAccess.entries()) {
      if (lineNumbers.length > 1 && lineNumbers[0] !== undefined && lineNumbers[lineNumbers.length - 1] !== undefined) {
        findings.push({
          startLine: lineNumbers[0]!,
          endLine: lineNumbers[lineNumbers.length - 1]!,
        });
      }
    }

    return findings;
  }


  private detectUnboundedLoops(code: string): Array<{ startLine: number; endLine: number }> {
    const findings: Array<{ startLine: number; endLine: number }> = [];
    const lines = code.split('\n');

    // Detect while loops or for loops over storage
    lines.forEach((line, index) => {
      if (line.includes('while') && !line.includes('//')) {
        if (!line.match(/while\s+\w+\s*[<>]=?\s*\d+/)) {
          findings.push({
            startLine: index + 1,
            endLine: index + 1,
          });
        }
      }

      // Check for loops over storage iterators
      if (line.includes('for') && line.includes('storage()') && line.includes('iter')) {
        findings.push({
          startLine: index + 1,
          endLine: index + 1,
        });
      }
    });

    return findings;
  }
}