/**
 * Sandbox Factory
 * 
 * Creates sandbox instances with appropriate strategies.
 */

import { RuleSandbox } from './rule-sandbox.service';
import { ISandbox } from './sandbox.interface';

export class SandboxFactory {
  /**
   * Create a standard rule sandbox
   */
  static createSandbox(): ISandbox {
    return new RuleSandbox();
  }

  /**
   * Create a sandbox with specific configuration
   */
  static createConfiguredSandbox(options: { 
    strategy: 'simple' | 'worker',
    defaultTimeoutMs?: number 
  }): ISandbox {
    if (options.strategy === 'worker') {
      // Worker threads sandbox would be implemented here for true isolation
      console.warn('Worker strategy not yet fully implemented, falling back to simple sandbox');
    }
    
    return new RuleSandbox();
  }
}
