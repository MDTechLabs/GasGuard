export interface GasGuardConfig {
  contracts: string[];
  output?: 'json' | 'table';
  failOnHigh?: boolean;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(config: unknown): GasGuardConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigValidationError(
      'Invalid config: configuration must be an object',
    );
  }

  const parsed = config as GasGuardConfig;

  if (!Array.isArray(parsed.contracts)) {
    throw new ConfigValidationError(
      'Invalid config: "contracts" must be an array',
    );
  }

  if (parsed.contracts.length === 0) {
    throw new ConfigValidationError(
      'Invalid config: at least one contract is required',
    );
  }

  for (const contract of parsed.contracts) {
    if (typeof contract !== 'string' || contract.trim() === '') {
      throw new ConfigValidationError(
        'Invalid config: all contract paths must be non-empty strings',
      );
    }
  }

  if (
    parsed.output &&
    !['json', 'table'].includes(parsed.output)
  ) {
    throw new ConfigValidationError(
      'Invalid config: "output" must be either "json" or "table"',
    );
  }

  if (
    parsed.failOnHigh !== undefined &&
    typeof parsed.failOnHigh !== 'boolean'
  ) {
    throw new ConfigValidationError(
      'Invalid config: "failOnHigh" must be a boolean',
    );
  }

  return parsed;
}