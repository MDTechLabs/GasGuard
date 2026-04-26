/**
 * Dynamic Rule Loader & Cache
 * 
 * Loads rules on demand and caches them to improve performance
 */

import { RuleConfiguration } from '../../config/config.types';

export interface RuleModule {
  id: string;
  version: string;
  execute: (context: any) => Promise<any>;
}

export class RuleCache {
  private cache: Map<string, RuleModule> = new Map();

  get(id: string, version: string): RuleModule | undefined {
    return this.cache.get(`${id}@${version}`);
  }

  set(id: string, version: string, module: RuleModule): void {
    this.cache.set(`${id}@${version}`, module);
  }

  clear(): void {
    this.cache.clear();
  }
}

export class DynamicRuleLoader {
  private cache: RuleCache = new RuleCache();

  /**
   * Load a rule on demand
   */
  async loadRule(config: RuleConfiguration): Promise<RuleModule | null> {
    const cached = this.cache.get(config.id, config.version);
    if (cached) {
      return cached;
    }

    try {
      console.log(`Dynamically loading rule: ${config.id}@${config.version}`);
      
      // In a real implementation, this would involve dynamic import()
      // For now, we simulate the loading process
      const module: RuleModule = {
        id: config.id,
        version: config.version,
        execute: async (context: any) => {
          console.log(`Executing rule ${config.id}`);
          return { success: true };
        }
      };

      this.cache.set(config.id, config.version, module);
      return module;
    } catch (error) {
      console.error(`Failed to load rule ${config.id}:`, error);
      return null;
    }
  }

  /**
   * Preload a set of rules
   */
  async preloadRules(configs: RuleConfiguration[]): Promise<void> {
    await Promise.all(configs.map(config => this.loadRule(config)));
  }
}
