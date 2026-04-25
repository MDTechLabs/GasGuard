/**
 * Rule Configuration Service
 * 
 * Manages rule-specific configuration and dynamic rule loading
 */

import { ConfigManager } from './config-manager';
import { RuleConfiguration, RuleCondition, RuleAction } from './config.types';

export class RuleConfigService {
  private configManager: ConfigManager;
  private static instance: RuleConfigService;

  private constructor() {
    this.configManager = ConfigManager.getInstance();
  }

  static getInstance(): RuleConfigService {
    if (!RuleConfigService.instance) {
      RuleConfigService.instance = new RuleConfigService();
    }
    return RuleConfigService.instance;
  }

  /**
   * Get all enabled rules for a specific language
   */
  getEnabledRulesForLanguage(language: string): RuleConfiguration[] {
    return this.configManager.getRulesByLanguage(language).filter(rule => rule.enabled);
  }

  /**
   * Get all enabled rules for a specific category
   */
  getEnabledRulesForCategory(category: string): RuleConfiguration[] {
    return this.configManager.getRulesByCategory(category).filter(rule => rule.enabled);
  }

  /**
   * Check if a rule is enabled
   */
  isRuleEnabled(ruleId: string): boolean {
    const rule = this.configManager.getRule(ruleId);
    return rule?.enabled ?? false;
  }

  /**
   * Get rule severity
   */
  getRuleSeverity(ruleId: string): string | undefined {
    const rule = this.configManager.getRule(ruleId);
    return rule?.severity;
  }

  /**
   * Get rule parameters
   */
  getRuleParameters(ruleId: string): Record<string, any> | undefined {
    const rule = this.configManager.getRule(ruleId);
    return rule?.parameters;
  }

  /**
   * Update rule parameters
   */
  async updateRuleParameters(ruleId: string, parameters: Record<string, any>): Promise<boolean> {
    return this.configManager.updateRule(ruleId, { parameters });
  }

  /**
   * Enable a rule
   */
  async enableRule(ruleId: string): Promise<boolean> {
    return this.configManager.enableRule(ruleId);
  }

  /**
   * Disable a rule
   */
  async disableRule(ruleId: string): Promise<boolean> {
    return this.configManager.disableRule(ruleId);
  }

  /**
   * Add a new rule configuration
   */
  async addRule(rule: RuleConfiguration): Promise<boolean> {
    return this.configManager.addRule(rule);
  }

  /**
   * Remove a rule configuration
   */
  async removeRule(ruleId: string): Promise<boolean> {
    return this.configManager.removeRule(ruleId);
  }

  /**
   * Get rules that match custom conditions
   */
  getRulesMatchingConditions(conditions: RuleCondition[]): RuleConfiguration[] {
    return this.configManager.getRules().filter(rule => {
      return this.evaluateConditions(rule, conditions);
    });
  }

  /**
   * Evaluate conditions against a rule
   */
  private evaluateConditions(rule: RuleConfiguration, conditions: RuleCondition[]): boolean {
    return conditions.every(condition => {
      const value = this.getFieldValue(rule, condition.field);
      return this.evaluateCondition(value, condition);
    });
  }

  /**
   * Get field value from rule
   */
  private getFieldValue(rule: RuleConfiguration, field: string): any {
    const parts = field.split('.');
    let current: any = rule;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(value: any, condition: RuleCondition): boolean {
    const { operator, value: conditionValue, caseSensitive = true } = condition;
    
    // Handle case sensitivity for strings
    if (typeof value === 'string' && typeof conditionValue === 'string' && !caseSensitive) {
      const lowerValue = value.toLowerCase();
      const lowerConditionValue = conditionValue.toLowerCase();
      
      switch (operator) {
        case 'equals':
          return lowerValue === lowerConditionValue;
        case 'not_equals':
          return lowerValue !== lowerConditionValue;
        case 'contains':
          return lowerValue.includes(lowerConditionValue);
        case 'not_contains':
          return !lowerValue.includes(lowerConditionValue);
        default:
          break;
      }
    }
    
    switch (operator) {
      case 'equals':
        return value === conditionValue;
      case 'not_equals':
        return value !== conditionValue;
      case 'contains':
        return typeof value === 'string' && value.includes(conditionValue);
      case 'not_contains':
        return typeof value === 'string' && !value.includes(conditionValue);
      case 'greater_than':
        return typeof value === 'number' && value > conditionValue;
      case 'less_than':
        return typeof value === 'number' && value < conditionValue;
      case 'in':
        return Array.isArray(conditionValue) && conditionValue.includes(value);
      case 'not_in':
        return Array.isArray(conditionValue) && !conditionValue.includes(value);
      default:
        return false;
    }
  }

  /**
   * Get rule dependencies
   */
  getRuleDependencies(ruleId: string): string[] {
    const rule = this.configManager.getRule(ruleId);
    return rule?.dependencies ?? [];
  }

  /**
   * Check if rule dependencies are satisfied
   */
  areDependenciesSatisfied(ruleId: string, enabledRules: Set<string>): boolean {
    const dependencies = this.getRuleDependencies(ruleId);
    return dependencies.every(dep => enabledRules.has(dep));
  }

  /**
   * Get rules in execution order based on dependencies
   */
  getRulesInExecutionOrder(): RuleConfiguration[] {
    const enabledRules = this.configManager.getEnabledRules();
    const ordered: RuleConfiguration[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (rule: RuleConfiguration) => {
      if (visiting.has(rule.id)) {
        throw new Error(`Circular dependency detected involving rule: ${rule.id}`);
      }
      
      if (visited.has(rule.id)) {
        return;
      }

      visiting.add(rule.id);

      // Visit dependencies first
      const dependencies = rule.dependencies ?? [];
      for (const depId of dependencies) {
        const depRule = enabledRules.find(r => r.id === depId);
        if (depRule) {
          visit(depRule);
        }
      }

      visiting.delete(rule.id);
      visited.add(rule.id);
      ordered.push(rule);
    };

    for (const rule of enabledRules) {
      visit(rule);
    }

    return ordered;
  }

  /**
   * Create a rule preset
   */
  createRulePreset(name: string, description: string, ruleIds: string[]): RuleConfiguration[] {
    const rules = ruleIds.map(id => this.configManager.getRule(id)).filter(Boolean) as RuleConfiguration[];
    
    return {
      name,
      description,
      rules,
      systemOverrides: {},
    } as any;
  }

  /**
   * Apply a rule preset
   */
  async applyRulePreset(preset: any): Promise<boolean> {
    try {
      // Update rules based on preset
      for (const ruleUpdate of preset.rules) {
        const existingRule = this.configManager.getRule(ruleUpdate.id);
        if (existingRule) {
          await this.configManager.updateRule(ruleUpdate.id, ruleUpdate);
        } else {
          await this.configManager.addRule(ruleUpdate);
        }
      }

      // Apply system overrides if any
      if (preset.systemOverrides) {
        await this.configManager.updateSystemConfig(preset.systemOverrides);
      }

      return true;
    } catch (error) {
      console.error('Error applying rule preset:', error);
      return false;
    }
  }

  /**
   * Validate rule configuration
   */
  validateRule(rule: RuleConfiguration): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!rule.id) {
      errors.push('Rule ID is required');
    }

    if (!rule.name) {
      errors.push('Rule name is required');
    }

    if (typeof rule.enabled !== 'boolean') {
      errors.push('Rule enabled flag must be boolean');
    }

    if (!rule.category) {
      errors.push('Rule category is required');
    }

    if (!rule.language) {
      errors.push('Rule language is required');
    }

    if (!['critical', 'high', 'medium', 'low', 'info'].includes(rule.severity)) {
      errors.push('Invalid severity level');
    }

    // Validate custom rules if present
    if (rule.customRules) {
      if (!rule.customRules.enabled || typeof rule.customRules.enabled !== 'boolean') {
        errors.push('Custom rules enabled flag must be boolean');
      }

      if (!Array.isArray(rule.customRules.conditions)) {
        errors.push('Custom rules conditions must be an array');
      }

      if (!Array.isArray(rule.customRules.actions)) {
        errors.push('Custom rules actions must be an array');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get configuration summary
   */
  getConfigurationSummary(): {
    totalRules: number;
    enabledRules: number;
    rulesByCategory: Record<string, number>;
    rulesByLanguage: Record<string, number>;
    rulesBySeverity: Record<string, number>;
  } {
    const rules = this.configManager.getRules();
    const enabledRules = rules.filter(rule => rule.enabled);

    const rulesByCategory: Record<string, number> = {};
    const rulesByLanguage: Record<string, number> = {};
    const rulesBySeverity: Record<string, number> = {};

    rules.forEach(rule => {
      rulesByCategory[rule.category] = (rulesByCategory[rule.category] || 0) + 1;
      rulesByLanguage[rule.language] = (rulesByLanguage[rule.language] || 0) + 1;
      rulesBySeverity[rule.severity] = (rulesBySeverity[rule.severity] || 0) + 1;
    });

    return {
      totalRules: rules.length,
      enabledRules: enabledRules.length,
      rulesByCategory,
      rulesByLanguage,
      rulesBySeverity,
    };
  }
}
