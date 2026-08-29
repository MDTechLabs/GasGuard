/**
 * Contract Pattern Types for Soroban/Stellar
 *
 * Defines the type system for representing, registering,
 * and matching recognized contract patterns in Soroban contracts.
 */

export enum PatternCategory {
  ACCESS_CONTROL = 'access-control',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  STORAGE = 'storage',
  EVENT = 'event',
  UPGRADE = 'upgrade',
  GAS_OPTIMIZATION = 'gas-optimization',
  ERROR_HANDLING = 'error-handling',
  MATH_SAFETY = 'math-safety',
  CROSS_CONTRACT = 'cross-contract',
  DEPLOYMENT = 'deployment',
  BEST_PRACTICE = 'best-practice',
  SECURITY = 'security',
}

export enum PatternSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

export interface ContractPattern {
  id: string;
  name: string;
  description: string;
  category: PatternCategory;
  severity: PatternSeverity;
  tags: string[];
  detectionLogic: PatternDetectionLogic;
  remediation?: string;
  references?: string[];
}

export interface PatternDetectionLogic {
  type: 'ast-node' | 'regex' | 'semantic' | 'custom';
  matcher: string | RegExp | ASTNodeMatcher | CustomMatcher;
  conditions?: PatternCondition[];
}

export interface ASTNodeMatcher {
  nodeType: string;
  properties?: Record<string, unknown>;
  children?: ASTNodeMatcher[];
}

export interface CustomMatcher {
  handler: string;
  config?: Record<string, unknown>;
}

export interface PatternCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists' | 'not-exists';
  value: unknown;
}

export interface PatternMatch {
  patternId: string;
  patternName: string;
  category: PatternCategory;
  severity: PatternSeverity;
  location: {
    startLine: number;
    endLine: number;
    file?: string;
  };
  confidence: number;
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface PatternLookupOptions {
  name?: string;
  category?: PatternCategory;
  severity?: PatternSeverity;
  tags?: string[];
}
