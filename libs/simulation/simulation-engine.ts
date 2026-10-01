import { ChainAdapter, SimulationResult } from "@chains/base-adapter";

export interface ComparisonReport {
  before: SimulationResult;
  after: SimulationResult;
  gasSaved: number;
  percentageImprovement: number;
  opcodeDiff: Record<string, number>;
}

export interface PolicySimulationConfig {
  /** Whether to enable policy simulation mode (dry-run) */
  simulationMode: boolean;
  /** Optional policy rules to apply during simulation */
  policyRules?: string[];
  /** Whether to include detailed policy violation reports */
  includePolicyDetails?: boolean;
}

export interface PolicySimulationResult extends SimulationResult {
  /** Policy violations detected during simulation */
  policyViolations?: PolicyViolation[];
  /** Whether this is a simulation result */
  isSimulation: boolean;
  /** Simulation timestamp */
  timestamp: number;
}

export interface PolicyViolation {
  /** Rule ID that was violated */
  ruleId: string;
  /** Rule name */
  ruleName: string;
  /** Description of the violation */
  description: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Suggested fix */
  suggestion: string;
  /** Line number where violation occurred */
  lineNumber?: number;
}

export class SimulationEngine {
  private simulationMode: boolean = false;
  private policyRules: string[] = [];

  constructor(private adapter: ChainAdapter) {}

  /**
   * Set policy simulation mode
   * When enabled, simulations run in dry-run mode and report policy violations
   */
  setPolicySimulationMode(config: PolicySimulationConfig): void {
    this.simulationMode = config.simulationMode;
    this.policyRules = config.policyRules || [];
  }

  /**
   * Check if engine is in policy simulation mode
   */
  isPolicySimulationMode(): boolean {
    return this.simulationMode;
  }

  async simulateExecution(
    code: string,
    method: string,
    params: any[],
  ): Promise<SimulationResult> {
    const result = await this.adapter.simulate(code, method, params);

    // If in simulation mode, return as PolicySimulationResult
    if (this.simulationMode) {
      return {
        ...result,
        isSimulation: true,
        timestamp: Date.now(),
        policyViolations: [], // Would be populated by policy analysis
      } as PolicySimulationResult;
    }

    return result;
  }

  /**
   * Simulate with policy analysis
   * This method combines execution simulation with policy violation detection
   */
  async simulateWithPolicy(
    code: string,
    method: string,
    params: any[],
    policyConfig?: PolicySimulationConfig,
  ): Promise<PolicySimulationResult> {
    const startTime = Date.now();
    const config = policyConfig || { simulationMode: true };
    this.setPolicySimulationMode(config);

    try {
      const result = await this.simulateExecution(code, method, params) as PolicySimulationResult;

      // Analyze for policy violations (placeholder - would integrate with rule engine)
      result.policyViolations = this.analyzePolicyViolations(code, config.policyRules);

      // Emit metrics
      const executionTime = Date.now() - startTime;
      this.emitPolicyMetrics(result.policyViolations.length, executionTime);

      return result;
    } catch (error) {
      // Log error with context
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] Policy simulation failed for method '${method}':`, error);

      // Re-throw with additional context
      throw new Error(`Policy simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze code for policy violations
   * This is a placeholder that would integrate with the Rust rule engine
   */
  private analyzePolicyViolations(code: string, rules?: string[]): PolicyViolation[] {
    // Placeholder implementation
    // In production, this would call the Rust rule engine via FFI or IPC
    const violations: PolicyViolation[] = [];

    // Log policy analysis start
    this.logPolicyAnalysisStart(rules);

    // Example: Check for common patterns
    if (code.includes('transfer') && !code.includes('require_auth')) {
      violations.push({
        ruleId: 'auth-check',
        ruleName: 'Authorization Check',
        description: 'Transfer function may be missing authorization',
        severity: 'error',
        suggestion: 'Add caller.require_auth() to ensure proper authorization',
        lineNumber: undefined,
      });
    }

    // Log policy analysis completion
    this.logPolicyAnalysisComplete(violations.length);

    return violations;
  }

  /**
   * Log policy analysis start
   */
  private logPolicyAnalysisStart(rules?: string[]): void {
    const timestamp = new Date().toISOString();
    const rulesInfo = rules ? rules.join(', ') : 'all rules';
    console.log(`[${timestamp}] Policy simulation started with rules: ${rulesInfo}`);
  }

  /**
   * Log policy analysis completion
   */
  private logPolicyAnalysisComplete(violationCount: number): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Policy simulation completed. Violations found: ${violationCount}`);
  }

  /**
   * Emit metrics for policy simulation
   */
  private emitPolicyMetrics(violationCount: number, executionTime: number): void {
    // In production, this would emit to a metrics system like Prometheus, Datadog, etc.
    const metrics = {
      policy_violations_total: violationCount,
      policy_simulation_duration_ms: executionTime,
      policy_simulation_timestamp: Date.now(),
    };

    console.log('Policy simulation metrics:', metrics);
  }

  async compareOptimizations(
    originalCode: string,
    optimizedCode: string,
    method: string,
    params: any[],
  ): Promise<ComparisonReport> {
    const [before, after] = await Promise.all([
      this.simulateExecution(originalCode, method, params),
      this.simulateExecution(optimizedCode, method, params),
    ]);

    const gasSaved = before.gasUsed - after.gasUsed;
    const percentageImprovement = (gasSaved / before.gasUsed) * 100;

    const opcodeDiff: Record<string, number> = {};
    // Calculate opcode frequency diff if available
    const beforeOps = this.getOpcodeFrequencies(before.opcodes);
    const afterOps = this.getOpcodeFrequencies(after.opcodes);

    const allOps = new Set([
      ...Object.keys(beforeOps),
      ...Object.keys(afterOps),
    ]);
    for (const op of allOps) {
      opcodeDiff[op] = (afterOps[op] || 0) - (beforeOps[op] || 0);
    }

    return {
      before,
      after,
      gasSaved,
      percentageImprovement,
      opcodeDiff,
    };
  }

  private getOpcodeFrequencies(opcodes: any[]): Record<string, number> {
    const freqs: Record<string, number> = {};
    for (const op of opcodes) {
      freqs[op.opcode] = (freqs[op.opcode] || 0) + 1;
    }
    return freqs;
  }
}
