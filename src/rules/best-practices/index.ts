import {
  BestPracticesConfig,
  DEFAULT_BEST_PRACTICES_CONFIG,
  validateBestPracticesConfig,
  BestPracticeRuleConfig,
} from './best-practices-config';
import { detectUnsafeIntTypes, SafeIntTypesResult } from './stellar/use-safe-int-types';
import { detectMutableStorageInView, ImmutableStorageResult } from './stellar/use-immutable-storage';
import { detectUncheckedArithmetic, CheckedArithmeticResult } from './stellar/use-checked-arithmetic';
import { detectMissingResultType, ResultTypesResult } from './stellar/use-result-types';
import { detectMissingInitialization, InitializationFunctionsResult } from './stellar/use-initialization-functions';

export interface BestPracticeFinding {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detected: boolean;
  details: Record<string, unknown>;
  message: string;
  suggestion: string;
}

export interface BestPracticesReport {
  findings: BestPracticeFinding[];
  summary: {
    total: number;
    detected: number;
    categories: Record<string, number>;
    severities: Record<string, number>;
  };
}

export type BestPracticeRule = {
  id: string;
  name: string;
  category: string;
  defaultSeverity: 'low' | 'medium' | 'high' | 'critical';
  check: (code: string) => BestPracticeFinding;
};

const RULES: BestPracticeRule[] = [
  {
    id: 'use-safe-int-types',
    name: 'Use Safe Integer Types',
    category: 'best-practices',
    defaultSeverity: 'medium',
    check: (code: string): BestPracticeFinding => {
      const result = detectUnsafeIntTypes(code);
      return {
        ruleId: 'use-safe-int-types',
        ruleName: 'Use Safe Integer Types',
        category: 'best-practices',
        severity: 'medium',
        detected: result.detected,
        details: { overSized: result.overSized },
        message: result.message,
        suggestion: result.suggestion,
      };
    },
  },
  {
    id: 'use-immutable-storage',
    name: 'Use Immutable Storage for Read-Only Data',
    category: 'best-practices',
    defaultSeverity: 'medium',
    check: (code: string): BestPracticeFinding => {
      const result = detectMutableStorageInView(code);
      return {
        ruleId: 'use-immutable-storage',
        ruleName: 'Use Immutable Storage for Read-Only Data',
        category: 'best-practices',
        severity: 'medium',
        detected: result.detected,
        details: { violations: result.violations },
        message: result.message,
        suggestion: result.suggestion,
      };
    },
  },
  {
    id: 'use-checked-arithmetic',
    name: 'Use Checked Arithmetic',
    category: 'best-practices',
    defaultSeverity: 'high',
    check: (code: string): BestPracticeFinding => {
      const result = detectUncheckedArithmetic(code);
      return {
        ruleId: 'use-checked-arithmetic',
        ruleName: 'Use Checked Arithmetic',
        category: 'best-practices',
        severity: 'high',
        detected: result.detected,
        details: { violations: result.violations },
        message: result.message,
        suggestion: result.suggestion,
      };
    },
  },
  {
    id: 'use-result-types',
    name: 'Use Result Return Types',
    category: 'best-practices',
    defaultSeverity: 'medium',
    check: (code: string): BestPracticeFinding => {
      const result = detectMissingResultType(code);
      return {
        ruleId: 'use-result-types',
        ruleName: 'Use Result Return Types',
        category: 'best-practices',
        severity: 'medium',
        detected: result.detected,
        details: { violations: result.violations },
        message: result.message,
        suggestion: result.suggestion,
      };
    },
  },
  {
    id: 'use-initialization-functions',
    name: 'Use Initialization Functions',
    category: 'best-practices',
    defaultSeverity: 'high',
    check: (code: string): BestPracticeFinding => {
      const result = detectMissingInitialization(code);
      return {
        ruleId: 'use-initialization-functions',
        ruleName: 'Use Initialization Functions',
        category: 'best-practices',
        severity: 'high',
        detected: result.detected,
        details: { violations: result.violations },
        message: result.message,
        suggestion: result.suggestion,
      };
    },
  },
];

export function getBestPracticeRules(): BestPracticeRule[] {
  return RULES;
}

export function getBestPracticeRule(ruleId: string): BestPracticeRule | undefined {
  return RULES.find(r => r.id === ruleId);
}

export function runBestPractices(
  code: string,
  config?: Partial<BestPracticesConfig>,
): BestPracticesReport {
  const resolvedConfig: BestPracticesConfig = config
    ? validateBestPracticesConfig({ rules: { ...DEFAULT_BEST_PRACTICES_CONFIG.rules, ...config.rules } })
    : DEFAULT_BEST_PRACTICES_CONFIG;

  const findings: BestPracticeFinding[] = [];

  for (const rule of RULES) {
    const ruleConfig: BestPracticeRuleConfig = resolvedConfig.rules[rule.id] ?? {
      enabled: true,
      severity: rule.defaultSeverity,
    };

    const finding = rule.check(code);
    finding.severity = ruleConfig.severity;
    if (!ruleConfig.enabled) {
      finding.detected = false;
    }
    findings.push(finding);
  }

  const detected = findings.filter(f => f.detected);
  const categories: Record<string, number> = {};
  const severities: Record<string, number> = {};

  for (const f of detected) {
    categories[f.category] = (categories[f.category] ?? 0) + 1;
    severities[f.severity] = (severities[f.severity] ?? 0) + 1;
  }

  return {
    findings,
    summary: {
      total: findings.length,
      detected: detected.length,
      categories,
      severities,
    },
  };
}

export {
  BestPracticesConfig,
  DEFAULT_BEST_PRACTICES_CONFIG,
  validateBestPracticesConfig,
  BestPracticesConfigError,
};
