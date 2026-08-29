/**
 * Soroban Upgrade Readiness Analyzer - Types
 *
 * Defines the type system for evaluating whether a Soroban contract
 * is ready for future upgrades. Analyzes storage structures, upgrade
 * patterns, versioning, and migration considerations.
 */

/** Upgrade readiness assessment result */
export interface UpgradeReadinessAnalysis {
  contractName: string;
  overallReadiness: ReadinessLevel;
  readinessScore: number;
  storageAnalysis: StorageAnalysis;
  upgradePatternAnalysis: UpgradePatternAnalysis;
  versioningAnalysis: VersioningAnalysis;
  migrationReadiness: MigrationReadiness;
  findings: UpgradeFinding[];
  recommendations: string[];
  summary: string;
}

/** Overall readiness level */
export type ReadinessLevel =
  | "excellent"
  | "good"
  | "fair"
  | "poor"
  | "critical";

/** Storage structure analysis */
export interface StorageAnalysis {
  hasVersionedStorage: boolean;
  storageEntries: StorageEntry[];
  storageLayout: StorageLayoutType;
  hasExtensibleStorage: boolean;
  storageRiskLevel: RiskLevel;
  storageIssues: string[];
  storageRecommendations: string[];
}

/** Individual storage entry */
export interface StorageEntry {
  name: string;
  type: string;
  lineNumber: number;
  isVersioned: boolean;
  isExtensible: boolean;
  riskLevel: RiskLevel;
  description: string;
}

/** Storage layout type */
export type StorageLayoutType =
  | "versioned"
  | "flat"
  | "namespaced"
  | "mixed"
  | "unknown";

/** Upgrade pattern analysis */
export interface UpgradePatternAnalysis {
  hasUpgradeFunction: boolean;
  upgradeMechanism: UpgradeMechanism;
  hasAccessControl: boolean;
  hasTimelock: boolean;
  hasEmergencyStop: boolean;
  upgradePatterns: DetectedUpgradePattern[];
  upgradeRiskLevel: RiskLevel;
  upgradeIssues: string[];
  upgradeRecommendations: string[];
}

/** Upgrade mechanism type */
export type UpgradeMechanism =
  | "proxy"
  | "migrator"
  | "version-switch"
  | "none"
  | "unknown";

/** Detected upgrade pattern */
export interface DetectedUpgradePattern {
  pattern: string;
  description: string;
  lineNumber: number;
  isRecommended: boolean;
  riskLevel: RiskLevel;
}

/** Versioning analysis */
export interface VersioningAnalysis {
  hasVersionInfo: boolean;
  currentVersion: string | null;
  hasVersionCheck: boolean;
  hasCompatibilityCheck: boolean;
  versioningRiskLevel: RiskLevel;
  versioningIssues: string[];
  versioningRecommendations: string[];
}

/** Migration readiness assessment */
export interface MigrationReadiness {
  hasMigrationPath: boolean;
  hasDataMigration: boolean;
  hasStatePreservation: boolean;
  hasRollbackCapability: boolean;
  migrationRiskLevel: RiskLevel;
  migrationIssues: string[];
  migrationRecommendations: string[];
}

/** Risk level for individual components */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Individual finding about upgrade readiness */
export interface UpgradeFinding {
  ruleId: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: UpgradeFindingCategory;
  location?: {
    file: string;
    startLine: number;
    endLine: number;
  };
  recommendation: string;
  impact: string;
}

/** Finding category */
export type UpgradeFindingCategory =
  | "storage-versioning"
  | "upgrade-mechanism"
  | "access-control"
  | "data-migration"
  | "rollback-capability"
  | "version-management"
  | "emergency-procedures"
  | "testing-coverage";

/** Configuration for upgrade readiness analyzer */
export interface UpgradeReadinessConfig {
  /** Minimum required versioning */
  requireVersioning: boolean;
  /** Require access control on upgrade functions */
  requireUpgradeAuth: boolean;
  /** Require timelock for upgrades */
  requireTimelock: boolean;
  /** Require emergency stop capability */
  requireEmergencyStop: boolean;
  /** Severity thresholds */
  thresholds: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
}
