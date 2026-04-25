/**
 * Configuration Manager
 * 
 * Centralized configuration management with validation and persistence
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  ConfigurationFile,
  RuleConfiguration,
  SystemConfiguration,
  ConfigurationProfile,
  ConfigurationValidationResult,
  ValidationError,
  ValidationWarning,
  ConfigurationChange,
  ConfigurationExport
} from './config.types';

export class ConfigManager extends EventEmitter {
  private static instance: ConfigManager;
  private config: ConfigurationFile;
  private configPath: string;
  private watchers: fs.FSWatcher[] = [];

  private constructor(configPath: string = './config/gasguard.config.json') {
    super();
    this.configPath = configPath;
    this.config = this.loadDefaultConfig();
    this.loadConfiguration();
    this.setupFileWatcher();
  }

  static getInstance(configPath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configPath);
    }
    return ConfigManager.instance;
  }

  private loadDefaultConfig(): ConfigurationFile {
    return {
      version: '1.0.0',
      lastUpdated: new Date(),
      system: {
        version: '1.0.0',
        environment: 'development',
        logging: {
          level: 'info',
          enableConsole: true,
          enableFile: true,
          enableAudit: true,
        },
        performance: {
          maxConcurrency: 4,
          timeoutMs: 30000,
          enableParallelExecution: true,
        },
        security: {
          enableApiKeyValidation: true,
          enableRateLimiting: true,
          maxRequestsPerMinute: 100,
        },
        features: {
          enableAutoFix: false,
          enableDetailedReporting: true,
          enableRealTimeMonitoring: true,
        },
      },
      rules: [],
      profiles: [],
    };
  }

  private loadConfiguration(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const loadedConfig = JSON.parse(content) as ConfigurationFile;
        
        // Validate and merge with defaults
        const validation = this.validateConfiguration(loadedConfig);
        if (validation.valid) {
          this.config = { ...this.loadDefaultConfig(), ...loadedConfig };
          this.emit('configLoaded', this.config);
        } else {
          console.error('Invalid configuration file, using defaults:', validation.errors);
        }
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
    }
  }

  private setupFileWatcher(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (fs.existsSync(configDir)) {
        const watcher = fs.watch(configDir, (eventType, filename) => {
          if (filename === path.basename(this.configPath)) {
            this.loadConfiguration();
          }
        });
        this.watchers.push(watcher);
      }
    } catch (error) {
      console.error('Error setting up file watcher:', error);
    }
  }

  getConfiguration(): ConfigurationFile {
    return { ...this.config };
  }

  getSystemConfiguration(): SystemConfiguration {
    return { ...this.config.system };
  }

  getRules(): RuleConfiguration[] {
    return [...this.config.rules];
  }

  getRule(id: string): RuleConfiguration | undefined {
    return this.config.rules.find(rule => rule.id === id);
  }

  getEnabledRules(): RuleConfiguration[] {
    return this.config.rules.filter(rule => rule.enabled);
  }

  getRulesByCategory(category: string): RuleConfiguration[] {
    return this.config.rules.filter(rule => rule.category === category);
  }

  getRulesByLanguage(language: string): RuleConfiguration[] {
    return this.config.rules.filter(rule => rule.language === language);
  }

  async updateRule(ruleId: string, updates: Partial<RuleConfiguration>): Promise<boolean> {
    const ruleIndex = this.config.rules.findIndex(rule => rule.id === ruleId);
    if (ruleIndex === -1) {
      return false;
    }

    const oldRule = { ...this.config.rules[ruleIndex] };
    this.config.rules[ruleIndex] = { ...oldRule, ...updates };
    this.config.lastUpdated = new Date();

    const change: ConfigurationChange = {
      type: 'update',
      target: 'rule',
      targetId: ruleId,
      oldValue: oldRule,
      newValue: this.config.rules[ruleIndex],
      timestamp: new Date(),
    };

    await this.saveConfiguration();
    this.emit('ruleUpdated', change);
    return true;
  }

  async addRule(rule: RuleConfiguration): Promise<boolean> {
    if (this.config.rules.some(r => r.id === rule.id)) {
      return false;
    }

    this.config.rules.push(rule);
    this.config.lastUpdated = new Date();

    const change: ConfigurationChange = {
      type: 'add',
      target: 'rule',
      targetId: rule.id,
      newValue: rule,
      timestamp: new Date(),
    };

    await this.saveConfiguration();
    this.emit('ruleAdded', change);
    return true;
  }

  async removeRule(ruleId: string): Promise<boolean> {
    const ruleIndex = this.config.rules.findIndex(rule => rule.id === ruleId);
    if (ruleIndex === -1) {
      return false;
    }

    const removedRule = this.config.rules[ruleIndex];
    this.config.rules.splice(ruleIndex, 1);
    this.config.lastUpdated = new Date();

    const change: ConfigurationChange = {
      type: 'delete',
      target: 'rule',
      targetId: ruleId,
      oldValue: removedRule,
      timestamp: new Date(),
    };

    await this.saveConfiguration();
    this.emit('ruleRemoved', change);
    return true;
  }

  async enableRule(ruleId: string): Promise<boolean> {
    return this.updateRule(ruleId, { enabled: true });
  }

  async disableRule(ruleId: string): Promise<boolean> {
    return this.updateRule(ruleId, { enabled: false });
  }

  async updateSystemConfig(updates: Partial<SystemConfiguration>): Promise<void> {
    const oldConfig = { ...this.config.system };
    this.config.system = { ...oldConfig, ...updates };
    this.config.lastUpdated = new Date();

    const change: ConfigurationChange = {
      type: 'update',
      target: 'system',
      targetId: 'system',
      oldValue: oldConfig,
      newValue: this.config.system,
      timestamp: new Date(),
    };

    await this.saveConfiguration();
    this.emit('systemConfigUpdated', change);
  }

  validateConfiguration(config: ConfigurationFile): ConfigurationValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate basic structure
    if (!config.version) {
      errors.push({
        path: 'version',
        message: 'Configuration version is required',
        code: 'MISSING_VERSION',
      });
    }

    if (!config.system) {
      errors.push({
        path: 'system',
        message: 'System configuration is required',
        code: 'MISSING_SYSTEM_CONFIG',
      });
    }

    if (!Array.isArray(config.rules)) {
      errors.push({
        path: 'rules',
        message: 'Rules must be an array',
        code: 'INVALID_RULES_FORMAT',
      });
    }

    // Validate rules
    if (config.rules) {
      const ruleIds = new Set<string>();
      config.rules.forEach((rule, index) => {
        if (!rule.id) {
          errors.push({
            path: `rules[${index}].id`,
            message: 'Rule ID is required',
            code: 'MISSING_RULE_ID',
          });
        } else if (ruleIds.has(rule.id)) {
          errors.push({
            path: `rules[${index}].id`,
            message: `Duplicate rule ID: ${rule.id}`,
            code: 'DUPLICATE_RULE_ID',
          });
        } else {
          ruleIds.add(rule.id);
        }

        if (typeof rule.enabled !== 'boolean') {
          errors.push({
            path: `rules[${index}].enabled`,
            message: 'Rule enabled flag must be boolean',
            code: 'INVALID_ENABLED_FLAG',
          });
        }

        if (!rule.name) {
          errors.push({
            path: `rules[${index}].name`,
            message: 'Rule name is required',
            code: 'MISSING_RULE_NAME',
          });
        }

        if (!rule.category) {
          warnings.push({
            path: `rules[${index}].category`,
            message: 'Rule category is recommended',
            code: 'MISSING_CATEGORY',
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private async saveConfiguration(): Promise<void> {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const content = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, content);
      this.emit('configSaved', this.config);
    } catch (error) {
      console.error('Error saving configuration:', error);
      throw error;
    }
  }

  async exportConfiguration(options: ConfigurationExport): Promise<string> {
    let exportData: any = {};

    if (options.includeSystem) {
      exportData.system = this.config.system;
    }

    if (options.includeRules) {
      let rules = this.config.rules;
      
      if (options.filter) {
        rules = rules.filter(rule => {
          if (options.filter!.categories && !options.filter!.categories.includes(rule.category)) {
            return false;
          }
          if (options.filter!.languages && !options.filter!.languages.includes(rule.language)) {
            return false;
          }
          if (options.filter!.enabled !== undefined && rule.enabled !== options.filter!.enabled) {
            return false;
          }
          return true;
        });
      }
      
      exportData.rules = rules;
    }

    if (options.includeProfiles) {
      exportData.profiles = this.config.profiles;
    }

    switch (options.format) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      case 'yaml':
        // For now, return JSON - would need yaml library
        return JSON.stringify(exportData, null, 2);
      case 'toml':
        // For now, return JSON - would need toml library
        return JSON.stringify(exportData, null, 2);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  async importConfiguration(configData: string, format: 'json' | 'yaml' | 'toml' = 'json'): Promise<boolean> {
    try {
      let parsed: any;
      
      switch (format) {
        case 'json':
          parsed = JSON.parse(configData);
          break;
        case 'yaml':
        case 'toml':
          // Would need appropriate parsers
          throw new Error(`Format ${format} not yet implemented`);
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      const validation = this.validateConfiguration(parsed);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      this.config = { ...this.config, ...parsed };
      this.config.lastUpdated = new Date();

      await this.saveConfiguration();
      this.emit('configImported', this.config);
      return true;
    } catch (error) {
      console.error('Error importing configuration:', error);
      return false;
    }
  }

  destroy(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    this.removeAllListeners();
  }
}
