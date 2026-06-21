export interface BestPracticeRuleConfig {
  enabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  parameters?: Record<string, unknown>;
}

export interface BestPracticesConfig {
  rules: Record<string, BestPracticeRuleConfig>;
}

export const DEFAULT_BEST_PRACTICES_CONFIG: BestPracticesConfig = {
  rules: {
    'use-safe-int-types': {
      enabled: true,
      severity: 'medium',
    },
    'use-immutable-storage': {
      enabled: true,
      severity: 'medium',
    },
    'use-checked-arithmetic': {
      enabled: true,
      severity: 'high',
    },
    'use-result-types': {
      enabled: true,
      severity: 'medium',
    },
    'use-initialization-functions': {
      enabled: true,
      severity: 'high',
    },
  },
};

export class BestPracticesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BestPracticesConfigError';
  }
}

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

export function validateBestPracticesConfig(config: unknown): BestPracticesConfig {
  if (!config || typeof config !== 'object') {
    throw new BestPracticesConfigError('Configuration must be an object');
  }

  const parsed = config as Record<string, unknown>;
  const rules = parsed.rules;

  if (!rules || typeof rules !== 'object') {
    throw new BestPracticesConfigError('Configuration must contain a "rules" object');
  }

  for (const [ruleId, ruleConfig] of Object.entries(rules)) {
    if (!ruleConfig || typeof ruleConfig !== 'object') {
      throw new BestPracticesConfigError(`Rule "${ruleId}" configuration must be an object`);
    }

    const rc = ruleConfig as Record<string, unknown>;

    if (rc.enabled !== undefined && typeof rc.enabled !== 'boolean') {
      throw new BestPracticesConfigError(`Rule "${ruleId}" "enabled" must be a boolean`);
    }

    if (rc.severity !== undefined && !VALID_SEVERITIES.includes(rc.severity as string)) {
      throw new BestPracticesConfigError(
        `Rule "${ruleId}" "severity" must be one of: ${VALID_SEVERITIES.join(', ')}`,
      );
    }

    if (rc.parameters !== undefined && (typeof rc.parameters !== 'object' || rc.parameters === null)) {
      throw new BestPracticesConfigError(`Rule "${ruleId}" "parameters" must be an object`);
    }
  }

  return config as BestPracticesConfig;
}
