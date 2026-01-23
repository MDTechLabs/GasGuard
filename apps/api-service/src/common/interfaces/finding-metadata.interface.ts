/**
 * Structured metadata for optimization findings
 * Provides comprehensive information about the finding's impact, reliability, and educational resources
 */

export enum ConfidenceLevel {
  CRITICAL = 'critical', // 95-100% confidence
  HIGH = 'high', // 80-95% confidence
  MEDIUM = 'medium', // 60-80% confidence
  LOW = 'low', // 40-60% confidence
  UNCERTAIN = 'uncertain', // <40% confidence
}

export enum SeverityLevel {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}

export enum ImpactType {
  GAS = 'gas',
  STORAGE = 'storage',
  SECURITY = 'security',
  MAINTAINABILITY = 'maintainability',
  PERFORMANCE = 'performance',
}

export interface ImpactEstimate {
  type: ImpactType;
  amount: number; // Estimated savings/improvement
  unit: 'gas' | 'bytes' | 'percentage' | 'count';
  range?: {
    min: number;
    max: number;
  };
  description: string;
}

export interface EducationalLink {
  title: string;
  url: string;
  source?: 'documentation' | 'blog' | 'standard' | 'best-practice' | 'security';
  description?: string;
}

export interface FindingMetadata {
  // Severity and Confidence
  severity: SeverityLevel;
  confidence: ConfidenceLevel;
  confidenceScore: number; // 0-100

  // Impact Information
  impacts: ImpactEstimate[];
  totalPotentialSavings?: {
    gas?: number;
    storage?: number;
  };

  // Educational Resources
  educationalLinks: EducationalLink[];

  // Additional Context
  affectedAspects: string[]; // e.g., ['state-access', 'storage-layout', 'function-calls']
  mitigation?: string; // How to fix the issue
  relatedRules?: string[]; // IDs of related rules
  tags?: string[]; // Custom tags for categorization

  // Metadata Management
  version: string; // Version of metadata schema
  createdAt?: string; // ISO timestamp
}

/**
 * Builder for creating structured finding metadata
 */
export class FindingMetadataBuilder {
  private metadata: Partial<FindingMetadata> = {
    version: '1.0',
  };

  setSeverity(severity: SeverityLevel): this {
    this.metadata.severity = severity;
    return this;
  }

  setConfidence(level: ConfidenceLevel, score: number): this {
    if (score < 0 || score > 100) {
      throw new Error('Confidence score must be between 0 and 100');
    }
    this.metadata.confidence = level;
    this.metadata.confidenceScore = score;
    return this;
  }

  addImpact(impact: ImpactEstimate): this {
    if (!this.metadata.impacts) {
      this.metadata.impacts = [];
    }
    this.metadata.impacts.push(impact);
    return this;
  }

  setImpacts(impacts: ImpactEstimate[]): this {
    this.metadata.impacts = impacts;
    return this;
  }

  addEducationalLink(link: EducationalLink): this {
    if (!this.metadata.educationalLinks) {
      this.metadata.educationalLinks = [];
    }
    this.metadata.educationalLinks.push(link);
    return this;
  }

  setEducationalLinks(links: EducationalLink[]): this {
    this.metadata.educationalLinks = links;
    return this;
  }

  setAffectedAspects(aspects: string[]): this {
    this.metadata.affectedAspects = aspects;
    return this;
  }

  setMitigation(mitigation: string): this {
    this.metadata.mitigation = mitigation;
    return this;
  }

  setRelatedRules(rules: string[]): this {
    this.metadata.relatedRules = rules;
    return this;
  }

  setTags(tags: string[]): this {
    this.metadata.tags = tags;
    return this;
  }

  setTotalSavings(gas?: number, storage?: number): this {
    this.metadata.totalPotentialSavings = { gas, storage };
    return this;
  }

  build(): FindingMetadata {
    const required = ['severity', 'confidence', 'confidenceScore', 'impacts', 'educationalLinks', 'affectedAspects'];
    const missing = required.filter(key => !(key in this.metadata));

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    return {
      ...this.metadata,
      version: '1.0',
      createdAt: new Date().toISOString(),
    } as FindingMetadata;
  }
}
