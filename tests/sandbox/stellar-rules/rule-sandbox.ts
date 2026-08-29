/**
 * Soroban Rule Testing Sandbox
 *
 * Provides isolated environments for testing new rules against
 * sample Soroban contracts. Enables running single rules or
 * all registered rules and inspecting results.
 */

import { Finding, Severity, BaseAnalyzer, AnalyzerConfig, Rule } from '@engine/core';
import { SAMPLE_CONTRACTS, SampleContract } from './sample-contracts';

export interface SandboxConfig {
  contractId?: string;
  enableAllRules?: boolean;
  ruleIds?: string[];
  timeout?: number;
  verbose?: boolean;
}

export interface SandboxResult {
  ruleId: string;
  ruleName: string;
  contractId: string;
  contractName: string;
  passed: boolean;
  findings: Finding[];
  executionTimeMs: number;
  error?: string;
}

export interface SandboxReport {
  totalRules: number;
  totalPassed: number;
  totalFailed: number;
  totalErrors: number;
  results: SandboxResult[];
  executionTimeMs: number;
}

const DEFAULT_CONFIG: Required<SandboxConfig> = {
  contractId: 'token',
  enableAllRules: false,
  ruleIds: [],
  timeout: 30000,
  verbose: false,
};

export class RuleSandbox {
  private analyzers: Map<string, BaseAnalyzer> = new Map();
  private config: Required<SandboxConfig>;
  private results: SandboxResult[] = [];

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Register an analyzer for use in the sandbox.
   */
  registerAnalyzer(name: string, analyzer: BaseAnalyzer): void {
    this.analyzers.set(name, analyzer);
  }

  /**
   * Create a new sandbox with the given configuration.
   */
  async createSandbox(config?: Partial<SandboxConfig>): Promise<RuleSandbox> {
    const sandbox = new RuleSandbox({ ...this.config, ...config });

    // Register any pre-configured analyzers from this sandbox
    for (const [name, analyzer] of this.analyzers) {
      sandbox.registerAnalyzer(name, analyzer);
    }

    await sandbox.initialize();
    return sandbox;
  }

  /**
   * Initialize the sandbox (placeholder for any async setup).
   */
  async initialize(): Promise<void> {
    this.results = [];
  }

  /**
   * Run a single rule against the specified or default sample contract.
   */
  async runRule(ruleId: string, config?: Partial<SandboxConfig>): Promise<SandboxResult> {
    const mergedConfig = { ...this.config, ...config };
    const contract = this.resolveContract(mergedConfig.contractId);

    if (!contract) {
      return {
        ruleId,
        ruleName: ruleId,
        contractId: mergedConfig.contractId,
        contractName: 'unknown',
        passed: false,
        findings: [],
        executionTimeMs: 0,
        error: `Contract '${mergedConfig.contractId}' not found`,
      };
    }

    const startTime = Date.now();

    try {
      const findings = await this.executeRule(ruleId, contract);
      const executionTimeMs = Date.now() - startTime;

      const result: SandboxResult = {
        ruleId,
        ruleName: ruleId,
        contractId: contract.id,
        contractName: contract.name,
        passed: true,
        findings,
        executionTimeMs,
      };

      if (mergedConfig.verbose) {
        this.logResult(result);
      }

      this.results.push(result);
      return result;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const result: SandboxResult = {
        ruleId,
        ruleName: ruleId,
        contractId: contract.id,
        contractName: contract.name,
        passed: false,
        findings: [],
        executionTimeMs,
        error: errorMessage,
      };

      this.results.push(result);
      return result;
    }
  }

  /**
   * Run all registered rules against the specified or default sample contract.
   */
  async runAllRules(config?: Partial<SandboxConfig>): Promise<SandboxReport> {
    const mergedConfig = { ...this.config, ...config };
    const startTime = Date.now();

    // Collect rule IDs to run
    let ruleIds: string[];

    if (mergedConfig.ruleIds && mergedConfig.ruleIds.length > 0) {
      ruleIds = mergedConfig.ruleIds;
    } else {
      ruleIds = this.collectAllRuleIds();
    }

    if (ruleIds.length === 0) {
      const executionTimeMs = Date.now() - startTime;
      return {
        totalRules: 0,
        totalPassed: 0,
        totalFailed: 0,
        totalErrors: 0,
        results: [],
        executionTimeMs,
      };
    }

    const results: SandboxResult[] = [];
    for (const ruleId of ruleIds) {
      const result = await this.runRule(ruleId, config);
      results.push(result);
    }

    const executionTimeMs = Date.now() - startTime;
    const totalPassed = results.filter((r) => r.passed && !r.error).length;
    const totalFailed = results.filter((r) => !r.passed && !r.error).length;
    const totalErrors = results.filter((r) => r.error).length;

    return {
      totalRules: results.length,
      totalPassed,
      totalFailed,
      totalErrors,
      results,
      executionTimeMs,
    };
  }

  /**
   * Reset the sandbox, clearing all results and registered analyzers.
   */
  async resetSandbox(): Promise<void> {
    this.analyzers.clear();
    this.results = [];
  }

  /**
   * Get the current results from the sandbox.
   */
  getResults(): SandboxResult[] {
    return [...this.results];
  }

  /**
   * Get the list of sample contracts available.
   */
  getAvailableContracts(): SampleContract[] {
    return Object.values(SAMPLE_CONTRACTS);
  }

  /**
   * Resolve a contract by ID, falling back to the default if not found.
   */
  private resolveContract(contractId?: string): SampleContract | undefined {
    const id = contractId ?? this.config.contractId;
    return SAMPLE_CONTRACTS[id];
  }

  /**
   * Collect all rule IDs from registered analyzers.
   */
  private collectAllRuleIds(): string[] {
    const ruleIds: string[] = [];

    for (const analyzer of this.analyzers.values()) {
      const rules = analyzer.getRules();
      for (const rule of rules) {
        if (!ruleIds.includes(rule.id)) {
          ruleIds.push(rule.id);
        }
      }
    }

    return ruleIds;
  }

  /**
   * Execute a single rule against a sample contract.
   * In a real implementation, this would invoke the analyzer.
   * Here we simulate the execution for sandbox testing purposes.
   */
  private async executeRule(
    ruleId: string,
    contract: SampleContract,
  ): Promise<Finding[]> {
    const analyzer = this.findAnalyzerForRule(ruleId);

    if (analyzer) {
      const analyzerConfig: AnalyzerConfig = {
        rules: {
          [ruleId]: { enabled: true },
        },
      };

      const result = await analyzer.analyze(
        contract.source,
        `${contract.id}.rs`,
        analyzerConfig,
      );
      return result.findings;
    }

    // Simulated execution when no analyzer is registered
    return this.simulateExecution(ruleId, contract);
  }

  /**
   * Find an analyzer that has the given rule.
   */
  private findAnalyzerForRule(ruleId: string): BaseAnalyzer | undefined {
    for (const analyzer of this.analyzers.values()) {
      const rules = analyzer.getRules();
      if (rules.some((r) => r.id === ruleId)) {
        return analyzer;
      }
    }
    return undefined;
  }

  /**
   * Simulate rule execution for sandbox testing without a real analyzer.
   * Generates mock findings based on rule ID and contract.
   */
  private async simulateExecution(
    ruleId: string,
    contract: SampleContract,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    if (ruleId.includes('auth') && contract.id === 'sample-auth') {
      findings.push({
        ruleId,
        message: 'Missing authentication check on sensitive_action',
        severity: Severity.HIGH,
        location: {
          file: `${contract.id}.rs`,
          startLine: 12,
          endLine: 16,
        },
      });
    }

    if (ruleId.includes('storage') && contract.id === 'sample-storage') {
      findings.push({
        ruleId,
        message: 'Inefficient storage read pattern detected',
        severity: Severity.MEDIUM,
        location: {
          file: `${contract.id}.rs`,
          startLine: 28,
          endLine: 32,
        },
      });
    }

    if (ruleId.includes('event') && contract.id === 'sample-event') {
      findings.push({
        ruleId,
        message: 'State change without event emission in transfer_no_event',
        severity: Severity.MEDIUM,
        location: {
          file: `${contract.id}.rs`,
          startLine: 9,
          endLine: 16,
        },
      });
    }

    if (ruleId.includes('math') && contract.id === 'sample-math') {
      findings.push({
        ruleId,
        message: 'Unchecked arithmetic operation may overflow',
        severity: Severity.MEDIUM,
        location: {
          file: `${contract.id}.rs`,
          startLine: 9,
          endLine: 9,
        },
      });
    }

    return findings;
  }

  /**
   * Log a sandbox result when verbose mode is enabled.
   */
  private logResult(result: SandboxResult): void {
    const status = result.passed ? '✓' : '✗';
    console.log(
      `[Sandbox] ${status} ${result.ruleName} on ${result.contractName} (${result.executionTimeMs}ms)`,
    );
    if (result.findings.length > 0) {
      console.log(
        `  -> ${result.findings.length} finding(s) detected`,
      );
    }
    if (result.error) {
      console.log(`  -> Error: ${result.error}`);
    }
  }
}
