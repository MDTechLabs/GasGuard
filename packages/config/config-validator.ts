/**
 * Configuration Validator
 * 
 * Validates configuration files and schemas
 */

import { 
  ConfigurationFile, 
  RuleConfiguration, 
  SystemConfiguration,
  ConfigurationValidationResult,
  ValidationError,
  ValidationWarning 
} from '../../src/config/config.types';

export class ConfigValidator {
  /**
   * Validate complete configuration file
   */
  validateConfiguration(config: ConfigurationFile): ConfigurationValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate top-level structure
    this.validateTopLevel(config, errors, warnings);
    
    // Validate system configuration
    if (config.system) {
      this.validateSystemConfig(config.system, errors, warnings);
    }
    
    // Validate rules
    if (config.rules) {
      this.validateRules(config.rules, errors, warnings);
    }
    
    // Validate profiles
    if (config.profiles) {
      this.validateProfiles(config.profiles, errors, warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateTopLevel(config: ConfigurationFile, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!config.version) {
      errors.push({
        path: 'version',
        message: 'Configuration version is required',
        code: 'MISSING_VERSION',
      });
    } else if (!this.isValidVersion(config.version)) {
      errors.push({
        path: 'version',
        message: 'Invalid version format (should be semantic version like 1.0.0)',
        code: 'INVALID_VERSION_FORMAT',
      });
    }

    if (!config.lastUpdated) {
      warnings.push({
        path: 'lastUpdated',
        message: 'Last updated timestamp is missing',
        code: 'MISSING_LAST_UPDATED',
      });
    }
  }

  private validateSystemConfig(system: SystemConfiguration, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (!system.version) {
      errors.push({
        path: 'system.version',
        message: 'System version is required',
        code: 'MISSING_SYSTEM_VERSION',
      });
    }

    if (!['development', 'staging', 'production'].includes(system.environment)) {
      errors.push({
        path: 'system.environment',
        message: 'Invalid environment (must be development, staging, or production)',
        code: 'INVALID_ENVIRONMENT',
      });
    }

    // Validate logging configuration
    if (system.logging) {
      if (!['debug', 'info', 'warn', 'error'].includes(system.logging.level)) {
        errors.push({
          path: 'system.logging.level',
          message: 'Invalid logging level',
          code: 'INVALID_LOG_LEVEL',
        });
      }

      if (typeof system.logging.enableConsole !== 'boolean') {
        errors.push({
          path: 'system.logging.enableConsole',
          message: 'enableConsole must be boolean',
          code: 'INVALID_ENABLE_CONSOLE',
        });
      }

      if (typeof system.logging.enableFile !== 'boolean') {
        errors.push({
          path: 'system.logging.enableFile',
          message: 'enableFile must be boolean',
          code: 'INVALID_ENABLE_FILE',
        });
      }

      if (typeof system.logging.enableAudit !== 'boolean') {
        errors.push({
          path: 'system.logging.enableAudit',
          message: 'enableAudit must be boolean',
          code: 'INVALID_ENABLE_AUDIT',
        });
      }
    }

    // Validate performance configuration
    if (system.performance) {
      if (typeof system.performance.maxConcurrency !== 'number' || system.performance.maxConcurrency < 1) {
        errors.push({
          path: 'system.performance.maxConcurrency',
          message: 'maxConcurrency must be a positive number',
          code: 'INVALID_MAX_CONCURRENCY',
        });
      }

      if (typeof system.performance.timeoutMs !== 'number' || system.performance.timeoutMs < 0) {
        errors.push({
          path: 'system.performance.timeoutMs',
          message: 'timeoutMs must be a non-negative number',
          code: 'INVALID_TIMEOUT',
        });
      }

      if (typeof system.performance.enableParallelExecution !== 'boolean') {
        errors.push({
          path: 'system.performance.enableParallelExecution',
          message: 'enableParallelExecution must be boolean',
          code: 'INVALID_PARALLEL_EXECUTION',
        });
      }
    }

    // Validate security configuration
    if (system.security) {
      if (typeof system.security.enableApiKeyValidation !== 'boolean') {
        errors.push({
          path: 'system.security.enableApiKeyValidation',
          message: 'enableApiKeyValidation must be boolean',
          code: 'INVALID_API_KEY_VALIDATION',
        });
      }

      if (typeof system.security.enableRateLimiting !== 'boolean') {
        errors.push({
          path: 'system.security.enableRateLimiting',
          message: 'enableRateLimiting must be boolean',
          code: 'INVALID_RATE_LIMITING',
        });
      }

      if (typeof system.security.maxRequestsPerMinute !== 'number' || system.security.maxRequestsPerMinute < 1) {
        errors.push({
          path: 'system.security.maxRequestsPerMinute',
          message: 'maxRequestsPerMinute must be a positive number',
          code: 'INVALID_MAX_REQUESTS',
        });
      }
    }

    // Validate features configuration
    if (system.features) {
      const featureFlags = ['enableAutoFix', 'enableDetailedReporting', 'enableRealTimeMonitoring'];
      featureFlags.forEach(flag => {
        if (typeof (system.features as any)[flag] !== 'boolean') {
          errors.push({
            path: `system.features.${flag}`,
            message: `${flag} must be boolean`,
            code: `INVALID_${flag.toUpperCase()}`,
          });
        }
      });
    }
  }

  private validateRules(rules: RuleConfiguration[], errors: ValidationError[], warnings: ValidationWarning[]): void {
    const ruleIds = new Set<string>();

    rules.forEach((rule, index) => {
      const prefix = `rules[${index}]`;

      // Validate required fields
      if (!rule.id) {
        errors.push({
          path: `${prefix}.id`,
          message: 'Rule ID is required',
          code: 'MISSING_RULE_ID',
        });
      } else {
        if (ruleIds.has(rule.id)) {
          errors.push({
            path: `${prefix}.id`,
            message: `Duplicate rule ID: ${rule.id}`,
            code: 'DUPLICATE_RULE_ID',
          });
        } else {
          ruleIds.add(rule.id);
        }

        if (!this.isValidRuleId(rule.id)) {
          errors.push({
            path: `${prefix}.id`,
            message: 'Invalid rule ID format (should be lowercase, alphanumeric, hyphens only)',
            code: 'INVALID_RULE_ID_FORMAT',
          });
        }
      }

      if (!rule.name) {
        errors.push({
          path: `${prefix}.name`,
          message: 'Rule name is required',
          code: 'MISSING_RULE_NAME',
        });
      }

      if (typeof rule.enabled !== 'boolean') {
        errors.push({
          path: `${prefix}.enabled`,
          message: 'Rule enabled flag must be boolean',
          code: 'INVALID_ENABLED_FLAG',
        });
      }

      if (!['critical', 'high', 'medium', 'low', 'info'].includes(rule.severity)) {
        errors.push({
          path: `${prefix}.severity`,
          message: 'Invalid severity level',
          code: 'INVALID_SEVERITY',
        });
      }

      if (!rule.category) {
        warnings.push({
          path: `${prefix}.category`,
          message: 'Rule category is recommended',
          code: 'MISSING_CATEGORY',
        });
      } else if (!this.isValidCategory(rule.category)) {
        warnings.push({
          path: `${prefix}.category`,
          message: 'Unknown category',
          code: 'UNKNOWN_CATEGORY',
        });
      }

      if (!rule.language) {
        warnings.push({
          path: `${prefix}.language`,
          message: 'Rule language is recommended',
          code: 'MISSING_LANGUAGE',
        });
      }

      // Validate dependencies
      if (rule.dependencies && Array.isArray(rule.dependencies)) {
        rule.dependencies.forEach((dep, depIndex) => {
          if (typeof dep !== 'string') {
            errors.push({
              path: `${prefix}.dependencies[${depIndex}]`,
              message: 'Dependency must be a string',
              code: 'INVALID_DEPENDENCY',
            });
          }
        });

        // Check for circular dependencies
        if (rule.id && rule.dependencies.includes(rule.id)) {
          errors.push({
            path: `${prefix}.dependencies`,
            message: 'Rule cannot depend on itself',
            code: 'SELF_DEPENDENCY',
          });
        }
      }

      // Validate custom rules
      if (rule.customRules) {
        this.validateCustomRules(rule.customRules, `${prefix}.customRules`, errors, warnings);
      }
    });
  }

  private validateCustomRules(customRules: any, path: string, errors: ValidationError[], warnings: ValidationWarning[]): void {
    if (typeof customRules.enabled !== 'boolean') {
      errors.push({
        path: `${path}.enabled`,
        message: 'Custom rules enabled flag must be boolean',
        code: 'INVALID_CUSTOM_RULES_ENABLED',
      });
    }

    if (!Array.isArray(customRules.conditions)) {
      errors.push({
        path: `${path}.conditions`,
        message: 'Custom rules conditions must be an array',
        code: 'INVALID_CONDITIONS_FORMAT',
      });
    } else {
      customRules.conditions.forEach((condition: any, index: number) => {
        this.validateCondition(condition, `${path}.conditions[${index}]`, errors);
      });
    }

    if (!Array.isArray(customRules.actions)) {
      errors.push({
        path: `${path}.actions`,
        message: 'Custom rules actions must be an array',
        code: 'INVALID_ACTIONS_FORMAT',
      });
    } else {
      customRules.actions.forEach((action: any, index: number) => {
        this.validateAction(action, `${path}.actions[${index}]`, errors);
      });
    }
  }

  private validateCondition(condition: any, path: string, errors: ValidationError[]): void {
    if (!condition.field || typeof condition.field !== 'string') {
      errors.push({
        path: `${path}.field`,
        message: 'Condition field is required and must be a string',
        code: 'INVALID_CONDITION_FIELD',
      });
    }

    const validOperators = ['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in'];
    if (!validOperators.includes(condition.operator)) {
      errors.push({
        path: `${path}.operator`,
        message: 'Invalid condition operator',
        code: 'INVALID_CONDITION_OPERATOR',
      });
    }

    if (condition.value === undefined || condition.value === null) {
      errors.push({
        path: `${path}.value`,
        message: 'Condition value is required',
        code: 'INVALID_CONDITION_VALUE',
      });
    }
  }

  private validateAction(action: any, path: string, errors: ValidationError[]): void {
    const validTypes = ['warn', 'error', 'info', 'custom'];
    if (!validTypes.includes(action.type)) {
      errors.push({
        path: `${path}.type`,
        message: 'Invalid action type',
        code: 'INVALID_ACTION_TYPE',
      });
    }

    if (action.severity && !['critical', 'high', 'medium', 'low', 'info'].includes(action.severity)) {
      errors.push({
        path: `${path}.severity`,
        message: 'Invalid action severity',
        code: 'INVALID_ACTION_SEVERITY',
      });
    }
  }

  private validateProfiles(profiles: any[], errors: ValidationError[], warnings: ValidationWarning[]): void {
    profiles.forEach((profile, index) => {
      const prefix = `profiles[${index}]`;

      if (!profile.name || typeof profile.name !== 'string') {
        errors.push({
          path: `${prefix}.name`,
          message: 'Profile name is required and must be a string',
          code: 'MISSING_PROFILE_NAME',
        });
      }

      if (!profile.description || typeof profile.description !== 'string') {
        warnings.push({
          path: `${prefix}.description`,
          message: 'Profile description is recommended',
          code: 'MISSING_PROFILE_DESCRIPTION',
        });
      }

      if (!Array.isArray(profile.rules)) {
        errors.push({
          path: `${prefix}.rules`,
          message: 'Profile rules must be an array',
          code: 'INVALID_PROFILE_RULES',
        });
      }
    });
  }

  private isValidVersion(version: string): boolean {
    return /^\d+\.\d+\.\d+(-.*)?$/.test(version);
  }

  private isValidRuleId(ruleId: string): boolean {
    return /^[a-z0-9-]+$/.test(ruleId);
  }

  private isValidCategory(category: string): boolean {
    const validCategories = [
      'security', 'performance', 'gas-optimization', 'best-practices',
      'solidity', 'soroban', 'vyper', 'rust', 'general'
    ];
    return validCategories.includes(category);
  }
}
