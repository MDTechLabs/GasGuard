/**
 * Factory for creating consistent finding metadata across the application
 * Ensures all findings have standardized severity, confidence, and educational resources
 */

import {
  FindingMetadata,
  FindingMetadataBuilder,
  SeverityLevel,
  ConfidenceLevel,
  ImpactType,
  EducationalLink,
} from '../interfaces/finding-metadata.interface';

export interface RuleMetadataConfig {
  ruleName: string;
  severity: SeverityLevel;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  impacts: {
    type: ImpactType;
    amount: number;
    unit: 'gas' | 'bytes' | 'percentage' | 'count';
    range?: { min: number; max: number };
    description: string;
  }[];
  educationalLinks: EducationalLink[];
  affectedAspects: string[];
  mitigation: string;
  relatedRules?: string[];
  tags?: string[];
}

/**
 * Predefined metadata configurations for common GasGuard rules
 */
export const RULE_METADATA_CATALOG: Record<string, RuleMetadataConfig> = {
  'unused-state-variables': {
    ruleName: 'unused-state-variables',
    severity: SeverityLevel.MEDIUM,
    confidence: ConfidenceLevel.CRITICAL,
    confidenceScore: 98,
    impacts: [
      {
        type: ImpactType.STORAGE,
        amount: 2500,
        unit: 'bytes',
        description: 'Unused state variables consume storage slots that cannot be reclaimed',
      },
      {
        type: ImpactType.GAS,
        amount: 20000,
        unit: 'gas',
        range: { min: 5000, max: 50000 },
        description: 'Gas cost to read/write unused variables in initialization',
      },
    ],
    educationalLinks: [
      {
        title: 'Solidity Storage Optimization',
        url: 'https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html',
        source: 'documentation',
        description: 'Official Solidity documentation on storage layout',
      },
      {
        title: 'Gas Optimization Best Practices',
        url: 'https://blog.openzeppelin.com/smart-contract-gas-optimization-tips/',
        source: 'best-practice',
        description: 'OpenZeppelin guide to smart contract gas optimization',
      },
    ],
    affectedAspects: ['state-storage', 'deployment-cost', 'runtime-gas'],
    mitigation: 'Remove the unused state variable declaration from the contract',
    relatedRules: ['uninitialized-state-variables', 'private-visibility'],
    tags: ['storage-optimization', 'code-quality', 'removal'],
  },

  'redundant-external': {
    ruleName: 'redundant-external',
    severity: SeverityLevel.LOW,
    confidence: ConfidenceLevel.HIGH,
    confidenceScore: 85,
    impacts: [
      {
        type: ImpactType.GAS,
        amount: 200,
        unit: 'gas',
        range: { min: 100, max: 400 },
        description: 'Gas savings from using external visibility instead of public',
      },
    ],
    educationalLinks: [
      {
        title: 'Solidity Function Visibility',
        url: 'https://docs.soliditylang.org/en/latest/contracts.html#visibility-and-getters',
        source: 'documentation',
        description: 'Understanding function visibility in Solidity',
      },
      {
        title: 'External vs Public Functions',
        url: 'https://ethereum.stackexchange.com/questions/43875/when-to-use-external-over-public',
        source: 'best-practice',
        description: 'When and why to use external visibility',
      },
    ],
    affectedAspects: ['function-calls', 'memory-allocation'],
    mitigation: 'Change function visibility from public to external if not called internally',
    relatedRules: ['internal-visibility'],
    tags: ['gas-optimization', 'visibility'],
  },

  'storage-layout-optimization': {
    ruleName: 'storage-layout-optimization',
    severity: SeverityLevel.HIGH,
    confidence: ConfidenceLevel.HIGH,
    confidenceScore: 92,
    impacts: [
      {
        type: ImpactType.STORAGE,
        amount: 32000,
        unit: 'bytes',
        range: { min: 0, max: 320000 },
        description: 'Potential storage savings from better variable packing',
      },
      {
        type: ImpactType.GAS,
        amount: 20000,
        unit: 'gas',
        range: { min: 5000, max: 50000 },
        description: 'Gas cost reduction from accessing packed storage slots',
      },
    ],
    educationalLinks: [
      {
        title: 'Solidity Storage Layout Reference',
        url: 'https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html',
        source: 'documentation',
      },
      {
        title: 'Smart Contract Storage Optimization',
        url: 'https://medium.com/@deliriousbliss/smart-contract-storage-optimization-c4c78de3d9e9',
        source: 'blog',
        description: 'Practical guide to storage optimization',
      },
    ],
    affectedAspects: ['storage-layout', 'state-variables', 'packing'],
    mitigation: 'Reorder state variables to pack multiple variables into fewer storage slots',
    relatedRules: ['unused-state-variables'],
    tags: ['storage-optimization', 'refactoring'],
  },

  'function-complexity': {
    ruleName: 'function-complexity',
    severity: SeverityLevel.MEDIUM,
    confidence: ConfidenceLevel.MEDIUM,
    confidenceScore: 72,
    impacts: [
      {
        type: ImpactType.MAINTAINABILITY,
        amount: 0,
        unit: 'percentage',
        description: 'High complexity reduces code maintainability and increases bug risk',
      },
      {
        type: ImpactType.GAS,
        amount: 0,
        unit: 'gas',
        description: 'Complex functions may have suboptimal gas usage',
      },
    ],
    educationalLinks: [
      {
        title: 'Cyclomatic Complexity in Smart Contracts',
        url: 'https://en.wikipedia.org/wiki/Cyclomatic_complexity',
        source: 'standard',
      },
      {
        title: 'Smart Contract Best Practices',
        url: 'https://consensys.net/diligence/blog/2019/09/smart-contract-best-practices-part-1/',
        source: 'best-practice',
      },
    ],
    affectedAspects: ['code-quality', 'complexity', 'testability'],
    mitigation: 'Refactor complex function into smaller, single-purpose functions',
    tags: ['maintainability', 'refactoring', 'complexity'],
  },
};

/**
 * Factory class for creating standardized finding metadata
 */
export class FindingMetadataFactory {
  /**
   * Create metadata for a known rule
   */
  static createForRule(ruleName: string, overrides?: Partial<RuleMetadataConfig>): FindingMetadata {
    const baseConfig = RULE_METADATA_CATALOG[ruleName];
    if (!baseConfig) {
      throw new Error(`No metadata configuration found for rule: ${ruleName}`);
    }

    const config = { ...baseConfig, ...overrides };
    return this.buildMetadata(config);
  }

  /**
   * Create metadata from a custom configuration
   */
  static createCustom(config: RuleMetadataConfig): FindingMetadata {
    return this.buildMetadata(config);
  }

  /**
   * Create metadata with minimal configuration (provides defaults)
   */
  static createMinimal(ruleName: string, severity: SeverityLevel): FindingMetadata {
    const builder = new FindingMetadataBuilder();
    builder
      .setSeverity(severity)
      .setConfidence(ConfidenceLevel.UNCERTAIN, 50)
      .setImpacts([])
      .setEducationalLinks([])
      .setAffectedAspects(['unknown'])
      .setMitigation('Review the rule documentation for more information');

    return builder.build();
  }

  /**
   * List all available rule metadata configurations
   */
  static getAvailableRules(): string[] {
    return Object.keys(RULE_METADATA_CATALOG);
  }

  /**
   * Validate that a FindingMetadata object is complete and correct
   */
  static validate(metadata: FindingMetadata): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!metadata.severity) {
      errors.push('Missing severity');
    }

    if (typeof metadata.confidenceScore !== 'number' || metadata.confidenceScore < 0 || metadata.confidenceScore > 100) {
      errors.push('Invalid confidence score (must be 0-100)');
    }

    if (!Array.isArray(metadata.impacts) || metadata.impacts.length === 0) {
      errors.push('At least one impact must be specified');
    }

    if (!Array.isArray(metadata.educationalLinks) || metadata.educationalLinks.length === 0) {
      errors.push('At least one educational link must be provided');
    }

    if (!Array.isArray(metadata.affectedAspects) || metadata.affectedAspects.length === 0) {
      errors.push('At least one affected aspect must be specified');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private static buildMetadata(config: RuleMetadataConfig): FindingMetadata {
    const builder = new FindingMetadataBuilder();

    builder
      .setSeverity(config.severity)
      .setConfidence(config.confidence, config.confidenceScore)
      .setImpacts(config.impacts)
      .setEducationalLinks(config.educationalLinks)
      .setAffectedAspects(config.affectedAspects)
      .setMitigation(config.mitigation);

    if (config.relatedRules) {
      builder.setRelatedRules(config.relatedRules);
    }

    if (config.tags) {
      builder.setTags(config.tags);
    }

    return builder.build();
  }
}
