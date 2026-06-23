export type RuleLifecycleStage = 'active' | 'deprecated' | 'sunset' | 'experimental' | 'beta';

export interface DeprecationNotice {
  deprecatedInVersion: string;
  removalVersion?: string;
  alternative?: string;
  reason: string;
  deprecationDate: Date;
}

export interface CompatibilityMetadata {
  engineVersion: string;
  stellarSdkVersion: string;
  supportedLanguages: string[];
  platformSupport: string[];
}

export interface RuleVersionInfo {
  version: string;
  changelog: string;
  date: Date;
  breaking: boolean;
}

export interface RuleLifecycleMetadata {
  ruleId: string;
  name: string;
  slug: string;
  stage: RuleLifecycleStage;
  currentVersion: string;
  versions: RuleVersionInfo[];
  deprecation?: DeprecationNotice;
  compatibility: CompatibilityMetadata;
  tags: string[];
  createdDate: Date;
  updatedDate: Date;
  author?: string;
}
