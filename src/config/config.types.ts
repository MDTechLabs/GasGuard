/**
 * Configuration Types
 * 
 * Defines the core types and interfaces for the configuration system
 */

export interface RuleConfiguration {
  id: string;
  name: string;
  enabled: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  language: string;
  description?: string;
  parameters?: Record<string, any>;
  dependencies?: string[];
  tags?: string[];
  customRules?: {
    enabled: boolean;
    conditions: RuleCondition[];
    actions: RuleAction[];
  };
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  value: any;
  caseSensitive?: boolean;
}

export interface RuleAction {
  type: 'warn' | 'error' | 'info' | 'custom';
  message?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  metadata?: Record<string, any>;
}

export interface SystemConfiguration {
  version: string;
  environment: 'development' | 'staging' | 'production';
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableConsole: boolean;
    enableFile: boolean;
    enableAudit: boolean;
  };
  performance: {
    maxConcurrency: number;
    timeoutMs: number;
    enableParallelExecution: boolean;
  };
  security: {
    enableApiKeyValidation: boolean;
    enableRateLimiting: boolean;
    maxRequestsPerMinute: number;
  };
  features: {
    enableAutoFix: boolean;
    enableDetailedReporting: boolean;
    enableRealTimeMonitoring: boolean;
  };
}

export interface ConfigurationFile {
  version: string;
  lastUpdated: Date;
  system: SystemConfiguration;
  rules: RuleConfiguration[];
  profiles?: ConfigurationProfile[];
}

export interface ConfigurationProfile {
  name: string;
  description: string;
  rules: Partial<RuleConfiguration>[];
  systemOverrides?: Partial<SystemConfiguration>;
}

export interface ConfigurationValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

export interface ConfigurationChange {
  type: 'add' | 'update' | 'delete' | 'enable' | 'disable';
  target: 'rule' | 'system' | 'profile';
  targetId: string;
  oldValue?: any;
  newValue?: any;
  timestamp: Date;
  userId?: string;
}

export interface ConfigurationExport {
  format: 'json' | 'yaml' | 'toml';
  includeSystem: boolean;
  includeRules: boolean;
  includeProfiles: boolean;
  filter?: {
    categories?: string[];
    languages?: string[];
    enabled?: boolean;
  };
}
