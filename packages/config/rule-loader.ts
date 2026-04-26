/**
 * Dynamic Rule Loader
 * 
 * Handles dynamic loading and unloading of rules based on configuration
 */

import { RuleConfiguration } from '../../src/config/config.types';

export interface RuleModule {
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;
  language: string;
  defaultSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  defaultParameters?: Record<string, any>;
  dependencies?: string[];
  
  // Rule implementation
  create(config?: RuleConfiguration): RuleInstance;
}

export interface RuleInstance {
  id: string;
  name: string;
  enabled: boolean;
  execute(context: any): Promise<any>;
  validate(): boolean;
  cleanup(): void;
}

export class RuleLoader {
  private static instance: RuleLoader;
  private loadedRules: Map<string, RuleInstance> = new Map();
  private ruleModules: Map<string, RuleModule[]> = new Map();

  private constructor() {}

  static getInstance(): RuleLoader {
    if (!RuleLoader.instance) {
      RuleLoader.instance = new RuleLoader();
    }
    return RuleLoader.instance;
  }

  /**
   * Register a rule module
   */
  registerRuleModule(module: RuleModule): void {
    const modules = this.ruleModules.get(module.id) || [];
    modules.push(module);
    this.ruleModules.set(module.id, modules);
  }

  /**
   * Load a rule based on configuration
   */
  async loadRule(config: RuleConfiguration): Promise<RuleInstance | null> {
    try {
      const modules = this.ruleModules.get(config.id);
      if (!modules || modules.length === 0) {
        console.warn(`Rule module not found: ${config.id}`);
        return null;
      }

      // Find specific version or default to latest
      let module = modules.find(m => m.version === config.version);
      
      if (!module && !config.version) {
        // Fallback to latest version if no version specified
        module = modules.sort((a, b) => b.version.localeCompare(a.version))[0];
      }

      if (!module) {
        console.warn(`Rule version ${config.version} not found for ${config.id}`);
        return null;
      }

      const instanceId = `${config.id}@${module.version}`;

      // Unload existing instance if any
      if (this.loadedRules.has(instanceId)) {
        await this.unloadRule(instanceId);
      }

      // Create new instance
      const instance = module.create(config);
      this.loadedRules.set(instanceId, instance);
      
      console.log(`Loaded rule: ${instanceId}`);
      return instance;
    } catch (error) {
      console.error(`Error loading rule ${config.id}:`, error);
      return null;
    }
  }

  /**
   * Unload a rule
   */
  async unloadRule(ruleId: string): Promise<boolean> {
    try {
      const instance = this.loadedRules.get(ruleId);
      if (instance) {
        instance.cleanup();
        this.loadedRules.delete(ruleId);
        console.log(`Unloaded rule: ${ruleId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error unloading rule ${ruleId}:`, error);
      return false;
    }
  }

  /**
   * Get loaded rule instance
   */
  getRule(ruleId: string): RuleInstance | undefined {
    return this.loadedRules.get(ruleId);
  }

  /**
   * Get all loaded rules
   */
  getAllRules(): RuleInstance[] {
    return Array.from(this.loadedRules.values());
  }

  /**
   * Check if a rule is loaded
   */
  isRuleLoaded(ruleId: string): boolean {
    return this.loadedRules.has(ruleId);
  }

  /**
   * Reload a rule with new configuration
   */
  async reloadRule(config: RuleConfiguration): Promise<RuleInstance | null> {
    await this.unloadRule(config.id);
    return this.loadRule(config);
  }

  /**
   * Load multiple rules based on configurations
   */
  async loadRules(configs: RuleConfiguration[]): Promise<RuleInstance[]> {
    const instances: RuleInstance[] = [];
    
    for (const config of configs) {
      if (config.enabled) {
        const instance = await this.loadRule(config);
        if (instance) {
          instances.push(instance);
        }
      }
    }
    
    return instances;
  }

  /**
   * Unload all rules
   */
  async unloadAllRules(): Promise<void> {
    const unloadPromises = Array.from(this.loadedRules.keys()).map(ruleId => 
      this.unloadRule(ruleId)
    );
    await Promise.all(unloadPromises);
  }

  /**
   * Get rule module information
   */
  getRuleModule(ruleId: string, version?: string): RuleModule | undefined {
    const modules = this.ruleModules.get(ruleId);
    if (!modules) return undefined;
    if (version) {
      return modules.find(m => m.version === version);
    }
    // Return latest if version not specified
    return modules.sort((a, b) => b.version.localeCompare(a.version))[0];
  }

  /**
   * Get all registered rule modules
   */
  getAllRuleModules(): RuleModule[] {
    return Array.from(this.ruleModules.values()).flat();
  }

  /**
   * Validate rule module
   */
  validateRuleModule(module: RuleModule): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!module.id) {
      errors.push('Rule module ID is required');
    }

    if (!module.name) {
      errors.push('Rule module name is required');
    }

    if (!module.category) {
      errors.push('Rule module category is required');
    }

    if (!module.language) {
      errors.push('Rule module language is required');
    }

    if (!module.create || typeof module.create !== 'function') {
      errors.push('Rule module must have a create function');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Auto-discover and register rule modules from a directory
   */
  async discoverRuleModules(directory: string): Promise<void> {
    // This would typically scan a directory for rule modules
    // For now, it's a placeholder for the implementation
    console.log(`Auto-discovering rule modules in: ${directory}`);
    
    // Example of what this would do:
    // 1. Scan directory for rule files
    // 2. Import each rule module
    // 3. Validate and register each module
  }

  /**
   * Get statistics about loaded rules
   */
  getStatistics(): {
    totalModules: number;
    loadedRules: number;
    rulesByCategory: Record<string, number>;
    rulesByLanguage: Record<string, number>;
  } {
    const rulesByCategory: Record<string, number> = {};
    const rulesByLanguage: Record<string, number> = {};

    for (const instance of this.loadedRules.values()) {
      // Try to find the module. We might need to parse the version from somewhere 
      // or store the module reference in the instance.
      // For now, we search all modules for this ID.
      const modules = this.ruleModules.get(instance.id);
      const module = modules?.[0]; // Best effort: use first version for stats if we can't distinguish
      if (module) {
        rulesByCategory[module.category] = (rulesByCategory[module.category] || 0) + 1;
        rulesByLanguage[module.language] = (rulesByLanguage[module.language] || 0) + 1;
      }
    }

    return {
      totalModules: this.ruleModules.size,
      loadedRules: this.loadedRules.size,
      rulesByCategory,
      rulesByLanguage,
    };
  }
}
