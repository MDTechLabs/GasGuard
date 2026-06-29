/**
 * Soroban Upgrade Readiness Analyzer
 *
 * Evaluates whether a Soroban contract is ready for future upgrades.
 * Analyzes storage structures, upgrade patterns, versioning, access control,
 * and migration considerations to provide a comprehensive readiness assessment.
 */

import {
  UpgradeReadinessAnalysis,
  ReadinessLevel,
  StorageAnalysis,
  StorageEntry,
  StorageLayoutType,
  UpgradePatternAnalysis,
  UpgradeMechanism,
  DetectedUpgradePattern,
  VersioningAnalysis,
  MigrationReadiness,
  UpgradeFinding,
  RiskLevel,
  UpgradeReadinessConfig,
} from "./types";

export class StellarUpgradeReadinessAnalyzer {
  private source: string;
  private filePath: string;
  private config: UpgradeReadinessConfig;
  private findings: UpgradeFinding[] = [];

  constructor(
    source: string,
    filePath: string,
    config: Partial<UpgradeReadinessConfig> = {},
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = {
      requireVersioning: true,
      requireUpgradeAuth: true,
      requireTimelock: false,
      requireEmergencyStop: true,
      thresholds: {
        excellent: 90,
        good: 70,
        fair: 50,
        poor: 30,
      },
      ...config,
    };
  }

  /**
   * Perform comprehensive upgrade readiness analysis
   */
  analyze(): UpgradeReadinessAnalysis {
    this.findings = [];

    const contractName = this.extractContractName();
    const storageAnalysis = this.analyzeStorage();
    const upgradePatternAnalysis = this.analyzeUpgradePatterns();
    const versioningAnalysis = this.analyzeVersioning();
    const migrationReadiness = this.analyzeMigrationReadiness();

    const readinessScore = this.calculateReadinessScore(
      storageAnalysis,
      upgradePatternAnalysis,
      versioningAnalysis,
      migrationReadiness,
    );

    const overallReadiness = this.determineReadinessLevel(readinessScore);
    const recommendations = this.generateRecommendations(
      storageAnalysis,
      upgradePatternAnalysis,
      versioningAnalysis,
      migrationReadiness,
    );

    const summary = this.generateSummary(
      contractName,
      overallReadiness,
      readinessScore,
      storageAnalysis,
      upgradePatternAnalysis,
      versioningAnalysis,
      migrationReadiness,
    );

    return {
      contractName,
      overallReadiness,
      readinessScore,
      storageAnalysis,
      upgradePatternAnalysis,
      versioningAnalysis,
      migrationReadiness,
      findings: this.findings,
      recommendations,
      summary,
    };
  }

  /**
   * Analyze storage structures for upgrade readiness
   */
  private analyzeStorage(): StorageAnalysis {
    const storageEntries = this.extractStorageEntries();
    const hasVersionedStorage = this.detectVersionedStorage();
    const hasExtensibleStorage = this.detectExtensibleStorage();
    const storageLayout = this.determineStorageLayout(storageEntries);
    const storageIssues: string[] = [];
    const storageRecommendations: string[] = [];

    // Check for versioned storage
    if (!hasVersionedStorage && this.config.requireVersioning) {
      storageIssues.push(
        "No versioned storage detected. Storage layout may break during upgrades.",
      );
      this.addFinding({
        ruleId: "stellar-upgrade-storage-versioning",
        message: "Contract lacks versioned storage structure",
        severity: "high",
        category: "storage-versioning",
        recommendation:
          "Use versioned storage keys or namespaced storage to support future upgrades",
        impact:
          "Storage data may become inaccessible or corrupted after contract upgrade",
      });
    }

    // Check for extensible storage patterns
    if (!hasExtensibleStorage) {
      storageIssues.push(
        "Storage is not extensible. Adding new fields may require full migration.",
      );
      storageRecommendations.push(
        "Consider using a map-based or extensible storage pattern",
      );
      this.addFinding({
        ruleId: "stellar-upgrade-storage-extensible",
        message: "Storage structure is not extensible",
        severity: "medium",
        category: "storage-versioning",
        recommendation:
          "Use Maps or extensible structs to allow future field additions",
        impact: "Future upgrades may require complex data migration",
      });
    }

    // Check for tightly packed storage that may hinder upgrades
    const hasTightPacking = this.detectTightStoragePacking();
    if (hasTightPacking) {
      storageRecommendations.push(
        "Tightly packed storage detected. Consider leaving gaps for future fields.",
      );
    }

    const storageRiskLevel = this.calculateStorageRisk(
      hasVersionedStorage,
      hasExtensibleStorage,
      storageEntries.length,
    );

    return {
      hasVersionedStorage,
      storageEntries,
      storageLayout,
      hasExtensibleStorage,
      storageRiskLevel,
      storageIssues,
      storageRecommendations,
    };
  }

  /**
   * Analyze upgrade patterns and mechanisms
   */
  private analyzeUpgradePatterns(): UpgradePatternAnalysis {
    const hasUpgradeFunction = this.detectUpgradeFunction();
    const upgradeMechanism = this.detectUpgradeMechanism();
    const hasAccessControl = this.detectUpgradeAccessControl();
    const hasTimelock = this.detectTimelock();
    const hasEmergencyStop = this.detectEmergencyStop();
    const upgradePatterns = this.detectUpgradePatterns();
    const upgradeIssues: string[] = [];
    const upgradeRecommendations: string[] = [];

    // Check for upgrade function
    if (!hasUpgradeFunction) {
      upgradeIssues.push(
        "No upgrade function detected. Contract cannot be upgraded safely.",
      );
      this.addFinding({
        ruleId: "stellar-upgrade-mechanism-missing",
        message: "Contract lacks upgrade mechanism",
        severity: "critical",
        category: "upgrade-mechanism",
        recommendation:
          "Implement a secure upgrade function with proper access control",
        impact:
          "Contract cannot be upgraded, bugs or improvements require deployment of new contract",
      });
    }

    // Check for access control on upgrades
    if (
      hasUpgradeFunction &&
      !hasAccessControl &&
      this.config.requireUpgradeAuth
    ) {
      upgradeIssues.push(
        "Upgrade function lacks access control. Anyone can upgrade the contract.",
      );
      this.addFinding({
        ruleId: "stellar-upgrade-auth-missing",
        message: "Upgrade function missing access control",
        severity: "critical",
        category: "access-control",
        recommendation:
          "Add require_auth or role-based access control to upgrade function",
        impact:
          "Unauthorized parties can upgrade contract and compromise state",
      });
      upgradeRecommendations.push(
        "Add owner-only or multi-sig authorization for upgrades",
      );
    }

    // Check for timelock
    if (hasUpgradeFunction && !hasTimelock && this.config.requireTimelock) {
      upgradeIssues.push(
        "No timelock on upgrades. Changes take effect immediately.",
      );
      this.addFinding({
        ruleId: "stellar-upgrade-timelock-missing",
        message: "Upgrade function lacks timelock protection",
        severity: "medium",
        category: "upgrade-mechanism",
        recommendation: "Implement timelock delay for upgrade execution",
        impact: "Upgrades execute immediately without user notification period",
      });
      upgradeRecommendations.push(
        "Add timelock mechanism for upgrade proposals",
      );
    }

    // Check for emergency stop
    if (!hasEmergencyStop && this.config.requireEmergencyStop) {
      upgradeIssues.push("No emergency stop mechanism detected.");
      this.addFinding({
        ruleId: "stellar-upgrade-emergency-stop-missing",
        message: "Contract lacks emergency stop capability",
        severity: "high",
        category: "emergency-procedures",
        recommendation: "Implement pause/emergency stop functionality",
        impact:
          "Cannot halt contract operations during upgrade or security incident",
      });
      upgradeRecommendations.push(
        "Add emergency pause functionality to halt operations during upgrades",
      );
    }

    const upgradeRiskLevel = this.calculateUpgradeRisk(
      hasUpgradeFunction,
      hasAccessControl,
      hasTimelock,
      hasEmergencyStop,
    );

    return {
      hasUpgradeFunction,
      upgradeMechanism,
      hasAccessControl,
      hasTimelock,
      hasEmergencyStop,
      upgradePatterns,
      upgradeRiskLevel,
      upgradeIssues,
      upgradeRecommendations,
    };
  }

  /**
   * Analyze versioning implementation
   */
  private analyzeVersioning(): VersioningAnalysis {
    const hasVersionInfo = this.detectVersionInfo();
    const currentVersion = this.extractVersion();
    const hasVersionCheck = this.detectVersionCheck();
    const hasCompatibilityCheck = this.detectCompatibilityCheck();
    const versioningIssues: string[] = [];
    const versioningRecommendations: string[] = [];

    if (!hasVersionInfo) {
      versioningIssues.push("No version information found in contract.");
      this.addFinding({
        ruleId: "stellar-upgrade-version-info-missing",
        message: "Contract does not expose version information",
        severity: "medium",
        category: "version-management",
        recommendation: "Add version() function and VERSION constant",
        impact: "Cannot determine contract version for upgrade compatibility",
      });
      versioningRecommendations.push(
        "Add public version() getter and VERSION constant",
      );
    }

    if (!hasVersionCheck && hasVersionInfo) {
      versioningIssues.push("No version validation checks detected.");
      this.addFinding({
        ruleId: "stellar-upgrade-version-check-missing",
        message: "No version validation during upgrade",
        severity: "high",
        category: "version-management",
        recommendation:
          "Add version checks to prevent downgrades or incompatible upgrades",
        impact: "May allow downgrades or incompatible version upgrades",
      });
      versioningRecommendations.push(
        "Implement version comparison logic in upgrade function",
      );
    }

    if (!hasCompatibilityCheck) {
      versioningRecommendations.push(
        "Add compatibility checks to verify storage schema compatibility during upgrades",
      );
    }

    const versioningRiskLevel = this.calculateVersioningRisk(
      hasVersionInfo,
      hasVersionCheck,
      hasCompatibilityCheck,
    );

    return {
      hasVersionInfo,
      currentVersion,
      hasVersionCheck,
      hasCompatibilityCheck,
      versioningRiskLevel,
      versioningIssues,
      versioningRecommendations,
    };
  }

  /**
   * Analyze migration readiness
   */
  private analyzeMigrationReadiness(): MigrationReadiness {
    const hasMigrationPath = this.detectMigrationPath();
    const hasDataMigration = this.detectDataMigration();
    const hasStatePreservation = this.detectStatePreservation();
    const hasRollbackCapability = this.detectRollbackCapability();
    const migrationIssues: string[] = [];
    const migrationRecommendations: string[] = [];

    if (!hasMigrationPath) {
      migrationIssues.push("No migration path defined for state transfer.");
      this.addFinding({
        ruleId: "stellar-upgrade-migration-path-missing",
        message: "Contract lacks migration path for upgrades",
        severity: "high",
        category: "data-migration",
        recommendation:
          "Implement migration function to transfer state to new version",
        impact: "State data may be lost during contract upgrade",
      });
      migrationRecommendations.push(
        "Create migration function to preserve state across upgrades",
      );
    }

    if (!hasDataMigration && hasMigrationPath) {
      migrationIssues.push(
        "Migration path exists but no data migration logic detected.",
      );
      this.addFinding({
        ruleId: "stellar-upgrade-data-migration-missing",
        message: "No data migration logic found",
        severity: "high",
        category: "data-migration",
        recommendation:
          "Implement data transformation logic for storage schema changes",
        impact: "Data format changes may cause incompatibility after upgrade",
      });
    }

    if (!hasStatePreservation) {
      migrationIssues.push("No state preservation mechanism detected.");
      this.addFinding({
        ruleId: "stellar-upgrade-state-preservation-missing",
        message: "No state preservation during upgrade",
        severity: "critical",
        category: "data-migration",
        recommendation:
          "Ensure critical state is preserved or migrated during upgrade",
        impact: "All contract state may be lost during upgrade",
      });
      migrationRecommendations.push(
        "Implement state snapshot and restore mechanism",
      );
    }

    if (!hasRollbackCapability) {
      migrationIssues.push("No rollback capability detected.");
      this.addFinding({
        ruleId: "stellar-upgrade-rollback-missing",
        message: "Contract cannot rollback failed upgrades",
        severity: "medium",
        category: "rollback-capability",
        recommendation: "Implement rollback mechanism for failed upgrades",
        impact: "Failed upgrades may leave contract in broken state",
      });
      migrationRecommendations.push(
        "Add rollback function to revert to previous version on failure",
      );
    }

    const migrationRiskLevel = this.calculateMigrationRisk(
      hasMigrationPath,
      hasDataMigration,
      hasStatePreservation,
      hasRollbackCapability,
    );

    return {
      hasMigrationPath,
      hasDataMigration,
      hasStatePreservation,
      hasRollbackCapability,
      migrationRiskLevel,
      migrationIssues,
      migrationRecommendations,
    };
  }

  // ==================== Helper Methods ====================

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/);
    return match ? match[1] : "UnknownContract";
  }

  private extractStorageEntries(): StorageEntry[] {
    const entries: StorageEntry[] = [];
    const structRegex = /pub struct \w+ \{([^}]+)\}/g;
    let structMatch;

    while ((structMatch = structRegex.exec(this.source)) !== null) {
      const structBody = structMatch[1];
      const fieldRegex = /pub\s+(\w+)\s*:\s*([^,\n]+)/g;
      let fieldMatch;

      while ((fieldMatch = fieldRegex.exec(structBody)) !== null) {
        const name = fieldMatch[1];
        const type = fieldMatch[2].trim();
        const lineNumber = this.getLineNumber(
          structMatch.index + fieldMatch.index,
        );

        entries.push({
          name,
          type,
          lineNumber,
          isVersioned: this.isFieldVersioned(name, type),
          isExtensible: this.isFieldExtensible(type),
          riskLevel: this.assessFieldRisk(type),
          description: `Storage field: ${name}`,
        });
      }
    }

    return entries;
  }

  private detectVersionedStorage(): boolean {
    return (
      this.source.includes("version") ||
      this.source.includes("VERSION") ||
      this.source.includes("schema_version") ||
      /storage_key.*v\d+/i.test(this.source) ||
      /namespaced/i.test(this.source)
    );
  }

  private detectExtensibleStorage(): boolean {
    return (
      this.source.includes("Map<") ||
      this.source.includes("HashMap<") ||
      this.source.includes("Vec<") ||
      this.source.includes("extend") ||
      this.source.includes("dynamic")
    );
  }

  private determineStorageLayout(entries: StorageEntry[]): StorageLayoutType {
    const versionedCount = entries.filter((e) => e.isVersioned).length;
    const totalEntries = entries.length;

    if (totalEntries === 0) return "unknown";
    if (versionedCount === totalEntries && versionedCount > 0)
      return "versioned";
    if (versionedCount > 0 && versionedCount < totalEntries) return "mixed";
    if (versionedCount > 0 && this.detectVersionedStorage()) return "versioned";

    // Check for namespaced pattern
    if (this.source.includes("namespace") || this.source.includes("prefix")) {
      return "namespaced";
    }

    return "flat";
  }

  private detectTightStoragePacking(): boolean {
    // Look for multiple small types declared consecutively
    const smallTypes = ["u8", "u16", "u32", "bool"];
    let consecutiveSmall = 0;

    const lines = this.source.split("\n");
    for (const line of lines) {
      const hasSmallType = smallTypes.some((t) => line.includes(`: ${t}`));
      if (hasSmallType) {
        consecutiveSmall++;
        if (consecutiveSmall >= 3) return true;
      } else {
        consecutiveSmall = 0;
      }
    }

    return false;
  }

  private detectUpgradeFunction(): boolean {
    return (
      /fn\s+upgrade/i.test(this.source) ||
      /fn\s+migrate/i.test(this.source) ||
      /fn\s+update_implementation/i.test(this.source) ||
      /fn\s+set_code/i.test(this.source)
    );
  }

  private detectUpgradeMechanism(): UpgradeMechanism {
    if (/proxy|forwarder/i.test(this.source)) return "proxy";
    if (/migrat/i.test(this.source)) return "migrator";
    if (/version.*switch|switch.*version/i.test(this.source))
      return "version-switch";
    if (this.detectUpgradeFunction()) return "unknown";
    return "none";
  }

  private detectUpgradeAccessControl(): boolean {
    return (
      this.source.includes("require_auth(") ||
      this.source.includes("require_auth (") ||
      (this.source.includes("owner") &&
        /fn\s+upgrade/i.test(this.source) &&
        /owner.*require_auth|require_auth.*owner/i.test(this.source)) ||
      (this.source.includes("admin") &&
        /fn\s+upgrade/i.test(this.source) &&
        /admin.*require_auth|require_auth.*admin/i.test(this.source)) ||
      this.source.includes("only_owner") ||
      this.source.includes("only_admin")
    );
  }

  private detectTimelock(): boolean {
    return (
      /timelock|time_lock/i.test(this.source) ||
      /delay.*upgrade/i.test(this.source) ||
      /upgrade.*delay/i.test(this.source) ||
      /ledger.*timestamp.*\+/i.test(this.source)
    );
  }

  private detectEmergencyStop(): boolean {
    return (
      /pause|emergency/i.test(this.source) ||
      /halt|stop/i.test(this.source) ||
      /circuit.*breaker/i.test(this.source) ||
      /is_paused|paused/i.test(this.source)
    );
  }

  private detectUpgradePatterns(): DetectedUpgradePattern[] {
    const patterns: DetectedUpgradePattern[] = [];

    // Check for proxy pattern
    if (/proxy|delegate/i.test(this.source)) {
      patterns.push({
        pattern: "proxy",
        description: "Proxy pattern detected for upgrade mechanism",
        lineNumber: this.findPatternLine(/proxy|delegate/),
        isRecommended: true,
        riskLevel: "low",
      });
    }

    // Check for migrator pattern
    if (/migrat/i.test(this.source)) {
      patterns.push({
        pattern: "migrator",
        description: "Migration pattern detected",
        lineNumber: this.findPatternLine(/migrat/),
        isRecommended: true,
        riskLevel: "low",
      });
    }

    // Check for admin-controlled upgrade
    if (this.detectUpgradeFunction() && this.detectUpgradeAccessControl()) {
      patterns.push({
        pattern: "admin-controlled",
        description: "Admin-controlled upgrade pattern",
        lineNumber: this.findPatternLine(/fn\s+upgrade/i),
        isRecommended: true,
        riskLevel: "medium",
      });
    }

    return patterns;
  }

  private detectVersionInfo(): boolean {
    return (
      /VERSION|version/i.test(this.source) ||
      /fn\s+version/i.test(this.source) ||
      /const.*VERSION/i.test(this.source)
    );
  }

  private extractVersion(): string | null {
    const versionMatch = this.source.match(/VERSION\s*=\s*"([^"]+)"/);
    if (versionMatch) return versionMatch[1];

    const versionFnMatch = this.source.match(
      /fn\s+version\s*\(\s*\)\s*->\s*String\s*\{[^}]*String::from_str\("([^"]+)"/,
    );
    if (versionFnMatch) return versionFnMatch[1];

    return null;
  }

  private detectVersionCheck(): boolean {
    return (
      /version.*check|check.*version/i.test(this.source) ||
      /version.*>=|version.*<=|version.*==/i.test(this.source) ||
      /require.*version/i.test(this.source)
    );
  }

  private detectCompatibilityCheck(): boolean {
    return (
      /compatib/i.test(this.source) ||
      /schema.*check|check.*schema/i.test(this.source) ||
      /validate.*storage/i.test(this.source)
    );
  }

  private detectMigrationPath(): boolean {
    return (
      /fn\s+migrat/i.test(this.source) ||
      /migrate_state|transfer_state/i.test(this.source) ||
      /migration/i.test(this.source)
    );
  }

  private detectDataMigration(): boolean {
    return (
      /transform.*data|data.*transform/i.test(this.source) ||
      /convert.*storage|storage.*convert/i.test(this.source) ||
      /map.*old.*new/i.test(this.source)
    );
  }

  private detectStatePreservation(): boolean {
    return (
      /preserve.*state|state.*preserve/i.test(this.source) ||
      /snapshot|restore/i.test(this.source) ||
      /save.*state|state.*save/i.test(this.source)
    );
  }

  private detectRollbackCapability(): boolean {
    return (
      /rollback|roll_back/i.test(this.source) ||
      /revert.*upgrade|upgrade.*revert/i.test(this.source) ||
      /fallback.*version/i.test(this.source)
    );
  }

  private isFieldVersioned(name: string, type: string): boolean {
    return (
      name.includes("version") ||
      type.includes("version") ||
      name.includes("v1") ||
      name.includes("v2")
    );
  }

  private isFieldExtensible(type: string): boolean {
    return (
      type.includes("Map<") ||
      type.includes("Vec<") ||
      type.includes("HashMap<")
    );
  }

  private assessFieldRisk(type: string): RiskLevel {
    if (type.includes("Map") || type.includes("Vec")) return "low";
    if (type.includes("Address") || type.includes("Balance")) return "medium";
    return "low";
  }

  private calculateStorageRisk(
    hasVersioned: boolean,
    hasExtensible: boolean,
    entryCount: number,
  ): RiskLevel {
    let risk = 0;
    if (!hasVersioned) risk += 3;
    if (!hasExtensible) risk += 2;
    if (entryCount > 10) risk += 1;

    if (risk >= 5) return "critical";
    if (risk >= 3) return "high";
    if (risk >= 2) return "medium";
    return "low";
  }

  private calculateUpgradeRisk(
    hasUpgrade: boolean,
    hasAuth: boolean,
    hasTimelock: boolean,
    hasEmergency: boolean,
  ): RiskLevel {
    let risk = 0;
    if (!hasUpgrade) risk += 4;
    if (hasUpgrade && !hasAuth) risk += 4;
    if (!hasTimelock) risk += 1;
    if (!hasEmergency) risk += 2;

    if (risk >= 7) return "critical";
    if (risk >= 5) return "high";
    if (risk >= 3) return "medium";
    return "low";
  }

  private calculateVersioningRisk(
    hasVersion: boolean,
    hasCheck: boolean,
    hasCompat: boolean,
  ): RiskLevel {
    let risk = 0;
    if (!hasVersion) risk += 3;
    if (!hasCheck) risk += 2;
    if (!hasCompat) risk += 1;

    if (risk >= 5) return "critical";
    if (risk >= 3) return "high";
    if (risk >= 2) return "medium";
    return "low";
  }

  private calculateMigrationRisk(
    hasPath: boolean,
    hasData: boolean,
    hasPreserve: boolean,
    hasRollback: boolean,
  ): RiskLevel {
    let risk = 0;
    if (!hasPath) risk += 2;
    if (!hasData) risk += 2;
    if (!hasPreserve) risk += 3;
    if (!hasRollback) risk += 1;

    if (risk >= 6) return "critical";
    if (risk >= 4) return "high";
    if (risk >= 2) return "medium";
    return "low";
  }

  private calculateReadinessScore(
    storage: StorageAnalysis,
    upgrade: UpgradePatternAnalysis,
    versioning: VersioningAnalysis,
    migration: MigrationReadiness,
  ): number {
    let score = 0;
    const maxScore = 100;

    // Storage: 25 points
    if (storage.hasVersionedStorage) score += 10;
    if (storage.hasExtensibleStorage) score += 10;
    if (storage.storageRiskLevel === "low") score += 5;

    // Upgrade: 35 points
    if (upgrade.hasUpgradeFunction) score += 10;
    if (upgrade.hasAccessControl) score += 10;
    if (upgrade.hasTimelock) score += 5;
    if (upgrade.hasEmergencyStop) score += 5;
    if (upgrade.upgradeRiskLevel === "low") score += 5;

    // Versioning: 20 points
    if (versioning.hasVersionInfo) score += 8;
    if (versioning.hasVersionCheck) score += 7;
    if (versioning.hasCompatibilityCheck) score += 5;

    // Migration: 20 points
    if (migration.hasMigrationPath) score += 5;
    if (migration.hasDataMigration) score += 5;
    if (migration.hasStatePreservation) score += 5;
    if (migration.hasRollbackCapability) score += 5;

    return Math.min(Math.round((score / maxScore) * 100), 100);
  }

  private determineReadinessLevel(score: number): ReadinessLevel {
    if (score >= this.config.thresholds.excellent) return "excellent";
    if (score >= this.config.thresholds.good) return "good";
    if (score >= this.config.thresholds.fair) return "fair";
    if (score >= this.config.thresholds.poor) return "poor";
    return "critical";
  }

  private generateRecommendations(
    storage: StorageAnalysis,
    upgrade: UpgradePatternAnalysis,
    versioning: VersioningAnalysis,
    migration: MigrationReadiness,
  ): string[] {
    const recommendations: string[] = [];

    recommendations.push(...storage.storageRecommendations);
    recommendations.push(...upgrade.upgradeRecommendations);
    recommendations.push(...versioning.versioningRecommendations);
    recommendations.push(...migration.migrationRecommendations);

    if (recommendations.length === 0) {
      recommendations.push(
        "Contract demonstrates good upgrade readiness practices",
      );
    }

    return recommendations;
  }

  private generateSummary(
    contractName: string,
    readiness: ReadinessLevel,
    score: number,
    storage: StorageAnalysis,
    upgrade: UpgradePatternAnalysis,
    versioning: VersioningAnalysis,
    migration: MigrationReadiness,
  ): string {
    const parts: string[] = [];
    parts.push(
      `Contract "${contractName}" upgrade readiness: ${readiness} (${score}/100)`,
    );

    if (storage.hasVersionedStorage) {
      parts.push("✓ Versioned storage");
    } else {
      parts.push("✗ No versioned storage");
    }

    if (upgrade.hasUpgradeFunction) {
      parts.push(`✓ Upgrade mechanism (${upgrade.upgradeMechanism})`);
    } else {
      parts.push("✗ No upgrade mechanism");
    }

    if (versioning.hasVersionInfo) {
      parts.push(
        `✓ Version tracking (${versioning.currentVersion || "detected"})`,
      );
    } else {
      parts.push("✗ No version tracking");
    }

    if (migration.hasStatePreservation) {
      parts.push("✓ State preservation");
    } else {
      parts.push("✗ No state preservation");
    }

    return parts.join(". ");
  }

  private addFinding(finding: Omit<UpgradeFinding, "location">): void {
    this.findings.push({
      ...finding,
      location: {
        file: this.filePath,
        startLine: 1,
        endLine: 1,
      },
    });
  }

  private getLineNumber(offset: number): number {
    const before = this.source.substring(0, offset);
    return (before.match(/\n/g) || []).length + 1;
  }

  private findPatternLine(pattern: RegExp): number {
    const match = pattern.exec(this.source);
    if (!match) return 1;
    return this.getLineNumber(match.index);
  }
}
