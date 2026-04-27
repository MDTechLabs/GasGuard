/**
 * Rule Executor
 * 
 * Orchestrates the loading and sandboxed execution of rules.
 */

import { DynamicRuleLoader, RuleModule } from '../loader/dynamic-loader';
import { RuleSandbox } from '../sandbox/rule-sandbox.service';
import { SandboxResult } from '../sandbox/sandbox.interface';
import { RuleConfiguration } from '../../config/config.types';

export interface RuleExecutionSummary {
  ruleId: string;
  success: boolean;
  result?: any;
  error?: string;
  durationMs: number;
}

export class RuleExecutor {
  private loader: DynamicRuleLoader;
  private sandbox: RuleSandbox;

  constructor() {
    this.loader = new DynamicRuleLoader();
    this.sandbox = new RuleSandbox();
  }

  /**
   * Execute a single rule by configuration
   */
  async executeRule(
    config: RuleConfiguration,
    context: any
  ): Promise<RuleExecutionSummary> {
    const ruleModule = await this.loader.loadRule(config);
    
    if (!ruleModule) {
      return {
        ruleId: config.id,
        success: false,
        error: 'Failed to load rule module',
        durationMs: 0
      };
    }

    const sandboxResult: SandboxResult = await this.sandbox.execute(
      ruleModule.execute,
      context,
      {
        timeoutMs: this.getTimeoutForCategory(config.category),
        debug: process.env.NODE_ENV === 'development'
      }
    );

    return {
      ruleId: config.id,
      success: sandboxResult.success,
      result: sandboxResult.data,
      error: sandboxResult.error?.message,
      durationMs: sandboxResult.metadata.durationMs
    };
  }

  /**
   * Execute multiple rules in sequence (safely)
   */
  async executeBatch(
    configs: RuleConfiguration[],
    context: any
  ): Promise<RuleExecutionSummary[]> {
    const summaries: RuleExecutionSummary[] = [];
    
    for (const config of configs) {
      if (!config.enabled) continue;
      
      const summary = await this.executeRule(config, context);
      summaries.push(summary);
    }
    
    return summaries;
  }

  /**
   * Determine timeout based on rule category
   */
  private getTimeoutForCategory(category: string): number {
    switch (category) {
      case 'complex-analysis':
        return 10000;
      case 'quick-check':
        return 1000;
      default:
        return 5000;
    }
  }
}
