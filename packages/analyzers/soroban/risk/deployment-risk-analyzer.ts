/**
 * Issue #932 — Soroban Deployment Risk Score Analyzer
 *
 * Consolidates security findings, resource findings, and deployment findings
 * into a single unified deployment risk score with explainable category breakdowns,
 * primary risk drivers, and deployment clearance recommendations.
 */

import {
  CategoryRiskSummary,
  DeploymentRiskFinding,
  DeploymentRiskPattern,
  DeploymentRiskScore,
  RiskCategory,
  RiskLevel,
  RiskSeverity,
  RiskWeightConfig,
} from './types';

// ── Default Weights & Configurations ─────────────────────────────────────────

export const DEFAULT_CATEGORY_WEIGHTS: Record<RiskCategory, number> = {
  security: 0.45,
  resource: 0.30,
  deployment: 0.25,
};

export const DEFAULT_SEVERITY_POINTS: Record<RiskSeverity, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
  info: 5,
};

export const DEFAULT_LEVEL_THRESHOLDS = {
  critical: 80,
  high: 60,
  medium: 35,
  low: 15,
};

export const DEFAULT_MAX_ACCEPTABLE_SCORE = 40;

export const DEFAULT_RISK_CONFIG: RiskWeightConfig = {
  categories: { ...DEFAULT_CATEGORY_WEIGHTS },
  severities: { ...DEFAULT_SEVERITY_POINTS },
  levelThresholds: { ...DEFAULT_LEVEL_THRESHOLDS },
  maxAcceptableScore: DEFAULT_MAX_ACCEPTABLE_SCORE,
  customRuleWeights: {},
};

// ── Rule Category Mapping Tables ─────────────────────────────────────────────

const RULE_CATEGORY_LOOKUP: Record<string, RiskCategory> = {
  // Security Rules
  'soroban-missing-auth': 'security',
  'soroban-unvalidated-contract-address': 'security',
  'soroban-unsafe-call-target': 'security',
  'soroban-weak-role-hierarchy': 'security',
  'soroban-missing-upgrade-guard': 'security',
  'soroban-reentrancy-risk': 'security',
  'soroban-unprotected-initialization': 'security',
  'soroban-arithmetic-checked-vs-wrapping': 'security',
  'soroban-authorization-cost': 'security',

  // Resource Rules
  'soroban-unbounded-loop': 'resource',
  'soroban-cpu-unbounded-loop': 'resource',
  'soroban-cpu-nested-loop': 'resource',
  'soroban-cpu-storage-in-loop': 'resource',
  'soroban-cpu-crypto-heavy': 'resource',
  'soroban-cpu-map-iteration': 'resource',
  'soroban-memory-large-vec-allocation': 'resource',
  'soroban-memory-nested-collection': 'resource',
  'soroban-memory-clone-in-loop': 'resource',
  'soroban-inefficient-storage': 'resource',
  'soroban-storage-rent': 'resource',
  'soroban-redundant-storage-read': 'resource',
  'soroban-redundant-clone': 'resource',
  'soroban-call-frequency': 'resource',
  'soroban-resource-budget': 'resource',

  // Deployment Rules
  'soroban-missing-instance-ttl-extension': 'deployment',
  'soroban-unbounded-persistent-growth': 'deployment',
  'soroban-inconsistent-visibility': 'deployment',
  'soroban-unversioned-contract-storage': 'deployment',
  'soroban-missing-emergency-pause': 'deployment',
  'soroban-excessive-contract-size': 'deployment',
  'soroban-unbounded-entrypoint-params': 'deployment',
  'soroban-missing-event-emission': 'deployment',
  'soroban-storage-lifetime-mismatch': 'deployment',
  'soroban-missing-admin-rotation': 'deployment',
};

// ── Deployment & Risk Static Patterns (for Direct Scanning) ───────────────────

export const RISK_SCAN_PATTERNS: DeploymentRiskPattern[] = [
  // ── Security Patterns ──
  {
    id: 'missing-auth',
    category: 'security',
    name: 'Missing Caller Authentication',
    description: 'Contract entry point modifies state or transfers funds without requiring caller auth',
    pattern: /pub\s+fn\s+(?:transfer|set_|admin_|update_|withdraw|mint|burn|upgrade)\w*\s*\([^)]*\)[^{]*\{(?![^{]*require_auth)/,
    severity: 'critical',
    riskWeight: 95,
    suggestion: 'Add `caller.require_auth()` before executing privileged state mutations.',
    isMultiLine: true,
  },
  {
    id: 'unprotected-init',
    category: 'security',
    name: 'Unprotected Contract Initialization',
    description: 'Initialization function can be called repeatedly without checking if already initialized',
    pattern: /pub\s+fn\s+(?:init|initialize|setup)\s*\([^)]*\)[^{]*\{(?![^{]*(?:has|get|is_initialized|require_auth))/,
    severity: 'critical',
    riskWeight: 90,
    suggestion: 'Guard initialization functions with a permanent `is_initialized` storage flag and admin check.',
    isMultiLine: true,
  },
  {
    id: 'unchecked-cross-contract',
    category: 'security',
    name: 'Unchecked Cross-Contract Invocation',
    description: 'Invoking external contract address without validation',
    pattern: /env\.invoke_contract\s*\(\s*&(?!admin|known_|trusted_|self\.)\w+/,
    severity: 'high',
    riskWeight: 75,
    suggestion: 'Validate external contract addresses against an allowlist or require explicit admin authorization.',
  },

  // ── Resource Patterns ──
  {
    id: 'unbounded-loop',
    category: 'resource',
    name: 'Unbounded Loop Structure',
    description: 'Loop iteration over dynamically-sized collections without an explicit bound or limit',
    pattern: /\b(for|while|loop)\b(?![^{]*\b(take|limit|MAX_|max_|break\b))/,
    severity: 'high',
    riskWeight: 80,
    suggestion: 'Enforce strict pagination or fixed upper bounds on iteration count to stay within CPU limits.',
  },
  {
    id: 'storage-in-loop',
    category: 'resource',
    name: 'Ledger Storage Inside Loop',
    description: 'Repeated persistent storage reads or writes inside loop iterations',
    pattern: /\b(for|while|loop)\b[\s\S]{0,300}?env\.storage\(\)\.(persistent|temporary|instance)\(\)/,
    severity: 'critical',
    riskWeight: 90,
    suggestion: 'Batch ledger read/write operations outside loops to avoid excessive storage costs and CPU consumption.',
    isMultiLine: true,
  },
  {
    id: 'large-allocation',
    category: 'resource',
    name: 'Large Memory Allocation',
    description: 'Pre-allocating high-capacity collections or deeply nested data structures',
    pattern: /Vec::with_capacity\s*\(\s*(\d{3,})\s*\)|Vec\s*<\s*Vec\s*</,
    severity: 'medium',
    riskWeight: 60,
    suggestion: 'Use streaming iterators or compact flat byte buffers to minimize memory footprint.',
  },

  // ── Deployment Patterns ──
  {
    id: 'missing-ttl-extension',
    category: 'deployment',
    name: 'Missing Storage TTL Extension',
    description: 'Persistent storage entries created without TTL extension safeguards',
    pattern: /env\.storage\(\)\.persistent\(\)\.set\([^)]+\)(?![\s\S]{0,300}extend_ttl)/,
    severity: 'high',
    riskWeight: 75,
    suggestion: 'Call `env.storage().persistent().extend_ttl(...)` to ensure critical contract state is not archived prematurely.',
    isMultiLine: true,
  },
  {
    id: 'missing-upgrade-guard',
    category: 'deployment',
    name: 'Missing Upgrade Guard Mechanism',
    description: 'Upgrade entrypoint lacks version check or multi-step migration protection',
    pattern: /pub\s+fn\s+upgrade\s*\([^)]*\)[^{]*\{(?![^{]*\b(require_auth|admin|version)\b)/,
    severity: 'critical',
    riskWeight: 85,
    suggestion: 'Implement strict admin auth, executable hash validation, and version bumping on contract upgrades.',
    isMultiLine: true,
  },
  {
    id: 'unversioned-state',
    category: 'deployment',
    name: 'Unversioned Storage Schema',
    description: 'Contract lacks schema versioning, making future contract migrations error-prone',
    pattern: /#\[contract\][\s\S]{0,400}pub\s+struct\s+\w+(?![\s\S]{0,800}(?:VERSION|SCHEMA_VERSION|version))/,
    severity: 'medium',
    riskWeight: 50,
    suggestion: 'Store a contract version identifier in instance storage to ensure safe schema migrations.',
    isMultiLine: true,
  },
  {
    id: 'inconsistent-visibility',
    category: 'deployment',
    name: 'Public Helper Function Exposure',
    description: 'Helper or internal computation method marked pub in contractimpl',
    pattern: /#\[contractimpl\][\s\S]{0,200}pub\s+fn\s+(?:calc_|helper_|internal_|compute_)\w+/,
    severity: 'low',
    riskWeight: 30,
    suggestion: 'Remove `pub` or move internal utilities to private non-contractimpl helper functions.',
    isMultiLine: true,
  },
];

// ── Analyzer Implementation ──────────────────────────────────────────────────

export class SorobanDeploymentRiskAnalyzer {
  private readonly config: RiskWeightConfig;

  constructor(customConfig: Partial<RiskWeightConfig> = {}) {
    this.config = this.mergeConfig(customConfig);
    this.validateConfig(this.config);
  }

  /**
   * Main entrypoint: Evaluate raw findings and compute a consolidated deployment risk score.
   */
  public evaluateFindings(
    rawFindings: Array<DeploymentRiskFinding | Record<string, any>>,
    overrideConfig?: Partial<RiskWeightConfig>,
    contractPath?: string,
  ): DeploymentRiskScore {
    const config = overrideConfig
      ? this.mergeConfig(overrideConfig)
      : this.config;
    this.validateConfig(config);

    const findings = this.normalizeFindings(rawFindings);
    const categoryBreakdown = this.calculateCategoryBreakdowns(findings, config);

    // Compute composite weighted risk score
    let rawComposite = 0;
    for (const cat of ['security', 'resource', 'deployment'] as RiskCategory[]) {
      rawComposite += categoryBreakdown[cat].score * categoryBreakdown[cat].weight;
    }

    const compositeScore = Math.min(100, Math.max(0, Math.round(rawComposite)));
    const riskLevel = this.determineRiskLevel(compositeScore, config.levelThresholds);

    const blockers = this.identifyBlockers(compositeScore, categoryBreakdown, config);
    const readyForDeployment = blockers.length === 0;

    const primaryRiskDrivers = this.identifyPrimaryRiskDrivers(findings, categoryBreakdown);
    const remediationSuggestions = this.deriveRemediationSuggestions(findings, categoryBreakdown);
    const rationale = this.generateRationale(
      compositeScore,
      riskLevel,
      categoryBreakdown,
      blockers,
      primaryRiskDrivers,
    );

    return {
      compositeScore,
      riskLevel,
      readyForDeployment,
      blockers,
      categoryBreakdown,
      findings,
      weights: config,
      rationale,
      primaryRiskDrivers,
      remediationSuggestions,
      analyzedAt: new Date().toISOString(),
      contractPath,
    };
  }

  /**
   * Analyze Soroban Rust source code directly for security, resource, and deployment risk patterns.
   */
  public analyzeSource(
    source: string,
    contractPath?: string,
    overrideConfig?: Partial<RiskWeightConfig>,
  ): DeploymentRiskScore {
    const findings: DeploymentRiskFinding[] = [];
    const lines = source.split('\n');

    for (const pattern of RISK_SCAN_PATTERNS) {
      if (pattern.isMultiLine) {
        const re = new RegExp(pattern.pattern.source, 'g');
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
          const line = source.slice(0, match.index).split('\n').length;
          findings.push({
            id: `${pattern.category}-${pattern.id}-${line}`,
            ruleId: `soroban-${pattern.id}`,
            category: pattern.category,
            severity: pattern.severity,
            message: `${pattern.name}: ${pattern.description}`,
            suggestion: pattern.suggestion,
            line,
            file: contractPath,
            weight: pattern.riskWeight,
          });
        }
      } else {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.pattern.test(lines[i])) {
            findings.push({
              id: `${pattern.category}-${pattern.id}-${i + 1}`,
              ruleId: `soroban-${pattern.id}`,
              category: pattern.category,
              severity: pattern.severity,
              message: `${pattern.name}: ${pattern.description} at line ${i + 1}`,
              suggestion: pattern.suggestion,
              line: i + 1,
              file: contractPath,
              weight: pattern.riskWeight,
            });
          }
        }
      }
    }

    return this.evaluateFindings(findings, overrideConfig, contractPath);
  }

  /**
   * Normalize arbitrary findings into standardized DeploymentRiskFinding records.
   */
  private normalizeFindings(
    raw: Array<DeploymentRiskFinding | Record<string, any>>,
  ): DeploymentRiskFinding[] {
    return raw.map((f, idx) => {
      const ruleId = f.ruleId || f.id || `custom-rule-${idx + 1}`;
      const category = this.categorizeRule(ruleId, f.category);
      const severity = this.normalizeSeverity(f.severity);
      const message = f.message || f.description || `Violation for rule ${ruleId}`;
      const line = f.line ?? f.location?.startLine ?? f.location?.line;
      const file = f.file ?? f.location?.file;

      return {
        id: f.id || `${category}-${ruleId}-${idx}`,
        ruleId,
        category,
        severity,
        message,
        description: f.description,
        suggestion: f.suggestion || f.suggestedFix?.description,
        line,
        file,
        weight: f.weight ?? f.estimatedRiskWeight,
        metadata: f.metadata,
      };
    });
  }

  /**
   * Determine the risk category for a given rule or override.
   */
  public categorizeRule(ruleId: string, explicitCategory?: string): RiskCategory {
    if (
      explicitCategory === 'security' ||
      explicitCategory === 'resource' ||
      explicitCategory === 'deployment'
    ) {
      return explicitCategory;
    }

    if (RULE_CATEGORY_LOOKUP[ruleId]) {
      return RULE_CATEGORY_LOOKUP[ruleId];
    }

    const lower = ruleId.toLowerCase();
    if (
      lower.includes('auth') ||
      lower.includes('sec') ||
      lower.includes('role') ||
      lower.includes('reentrancy') ||
      lower.includes('overflow') ||
      lower.includes('guard') ||
      lower.includes('access')
    ) {
      return 'security';
    }

    if (
      lower.includes('cpu') ||
      lower.includes('memory') ||
      lower.includes('loop') ||
      lower.includes('gas') ||
      lower.includes('cost') ||
      lower.includes('rent') ||
      lower.includes('storage') ||
      lower.includes('alloc') ||
      lower.includes('call')
    ) {
      return 'resource';
    }

    return 'deployment';
  }

  private normalizeSeverity(sev?: string): RiskSeverity {
    if (!sev) return 'medium';
    const lower = sev.toLowerCase();
    if (lower === 'critical' || lower === 'crit') return 'critical';
    if (lower === 'high') return 'high';
    if (lower === 'medium' || lower === 'med' || lower === 'warn' || lower === 'warning') return 'medium';
    if (lower === 'low') return 'low';
    return 'info';
  }

  /**
   * Compute the score and summary breakdown for each category.
   */
  private calculateCategoryBreakdowns(
    findings: DeploymentRiskFinding[],
    config: RiskWeightConfig,
  ): Record<RiskCategory, CategoryRiskSummary> {
    const categories: RiskCategory[] = ['security', 'resource', 'deployment'];
    const result: Partial<Record<RiskCategory, CategoryRiskSummary>> = {};

    for (const cat of categories) {
      const catFindings = findings.filter((f) => f.category === cat);
      const severityCounts: Record<RiskSeverity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };

      let rawScore = 0;
      for (const finding of catFindings) {
        severityCounts[finding.severity]++;
        const basePoints = config.severities[finding.severity] ?? DEFAULT_SEVERITY_POINTS[finding.severity];
        const customMultiplier = config.customRuleWeights?.[finding.ruleId] ?? 1.0;
        const findingWeight = finding.weight !== undefined ? finding.weight / 100 : 1.0;

        rawScore += basePoints * customMultiplier * findingWeight;
      }

      // Smooth saturation curve: diminishing returns for many findings to stay 0–100
      // 1 critical (100 pts) -> ~65-75 score. 2 criticals -> ~90 score.
      const normalizedScore =
        catFindings.length === 0
          ? 0
          : Math.min(100, Math.round(100 * (1 - Math.exp(-rawScore / 130))));

      const highestSeverity = this.getHighestSeverity(catFindings);
      const catWeight = config.categories[cat];
      const weightedScore = Math.round(normalizedScore * catWeight * 10) / 10;

      // Sort findings by severity then weight descending
      const sortedFindings = [...catFindings].sort((a, b) => {
        const diff = config.severities[b.severity] - config.severities[a.severity];
        if (diff !== 0) return diff;
        return (b.weight ?? 0) - (a.weight ?? 0);
      });

      result[cat] = {
        category: cat,
        score: normalizedScore,
        weight: catWeight,
        weightedScore,
        findingCount: catFindings.length,
        severityCounts,
        highestSeverity,
        topFindings: sortedFindings.slice(0, 5),
        summary: this.generateCategorySummary(cat, normalizedScore, catFindings.length, highestSeverity),
      };
    }

    return result as Record<RiskCategory, CategoryRiskSummary>;
  }

  private getHighestSeverity(findings: DeploymentRiskFinding[]): RiskSeverity | null {
    if (findings.length === 0) return null;
    const order: RiskSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of order) {
      if (findings.some((f) => f.severity === sev)) return sev;
    }
    return 'info';
  }

  private determineRiskLevel(
    score: number,
    thresholds: RiskWeightConfig['levelThresholds'],
  ): RiskLevel {
    if (score >= thresholds.critical) return 'critical';
    if (score >= thresholds.high) return 'high';
    if (score >= thresholds.medium) return 'medium';
    if (score >= thresholds.low) return 'low';
    return 'safe';
  }

  private identifyBlockers(
    score: number,
    breakdown: Record<RiskCategory, CategoryRiskSummary>,
    config: RiskWeightConfig,
  ): string[] {
    const blockers: string[] = [];
    const maxScore = config.maxAcceptableScore ?? DEFAULT_MAX_ACCEPTABLE_SCORE;

    if (score > maxScore) {
      blockers.push(
        `Overall deployment risk score (${score}/100) exceeds maximum acceptable threshold (${maxScore}/100).`,
      );
    }

    if (breakdown.security.severityCounts.critical > 0) {
      blockers.push(
        `${breakdown.security.severityCounts.critical} critical security finding(s) detected. Security flaws must be resolved prior to deployment.`,
      );
    }

    if (breakdown.deployment.severityCounts.critical > 0) {
      blockers.push(
        `${breakdown.deployment.severityCounts.critical} critical deployment architecture finding(s) detected.`,
      );
    }

    if (breakdown.resource.score >= 85) {
      blockers.push(
        `Resource consumption risk (${breakdown.resource.score}/100) indicates high likelihood of transaction aborts due to budget limits.`,
      );
    }

    return blockers;
  }

  private identifyPrimaryRiskDrivers(
    findings: DeploymentRiskFinding[],
    breakdown: Record<RiskCategory, CategoryRiskSummary>,
  ): string[] {
    const drivers: string[] = [];

    // Check dominant category
    const dominantCat = (Object.values(breakdown) as CategoryRiskSummary[])
      .sort((a, b) => b.score - a.score)[0];

    if (dominantCat && dominantCat.score > 0) {
      drivers.push(
        `Primary risk category: ${dominantCat.category.toUpperCase()} (${dominantCat.score}/100 score, ${dominantCat.findingCount} findings)`,
      );
    }

    // Top critical and high findings
    const topFindings = [...findings]
      .filter((f) => f.severity === 'critical' || f.severity === 'high')
      .slice(0, 4);

    for (const f of topFindings) {
      drivers.push(`[${f.severity.toUpperCase()}] ${f.message}`);
    }

    if (drivers.length === 0 && findings.length > 0) {
      drivers.push(`${findings.length} minor / moderate findings across contract code.`);
    } else if (drivers.length === 0) {
      drivers.push('No significant risk drivers identified.');
    }

    return drivers;
  }

  private deriveRemediationSuggestions(
    findings: DeploymentRiskFinding[],
    breakdown: Record<RiskCategory, CategoryRiskSummary>,
  ): string[] {
    const suggestions: string[] = [];
    const seen = new Set<string>();

    // Prioritize critical and high findings
    const prioritized = [...findings].sort((a, b) => {
      const sevOrder: Record<RiskSeverity, number> = {
        critical: 4,
        high: 3,
        medium: 2,
        low: 1,
        info: 0,
      };
      return sevOrder[b.severity] - sevOrder[a.severity];
    });

    for (const f of prioritized) {
      if (f.suggestion && !seen.has(f.suggestion)) {
        seen.add(f.suggestion);
        suggestions.push(f.suggestion);
      }
    }

    // Add category-specific fallbacks if needed
    if (breakdown.security.score >= 50 && !seen.has('security-audit')) {
      suggestions.push('Conduct an access control and authentication audit on all public contract entry points.');
    }
    if (breakdown.resource.score >= 50 && !seen.has('resource-budget')) {
      suggestions.push('Benchmark CPU instructions and ledger footprint on testnet with maximum expected collection sizes.');
    }
    if (breakdown.deployment.score >= 50 && !seen.has('ttl-management')) {
      suggestions.push('Verify state TTL extension policies and upgrade authorization guards.');
    }

    if (suggestions.length === 0) {
      suggestions.push('Contract meets standard risk benchmarks. Proceed with standard testnet deployment verification.');
    }

    return suggestions;
  }

  private generateRationale(
    compositeScore: number,
    riskLevel: RiskLevel,
    breakdown: Record<RiskCategory, CategoryRiskSummary>,
    blockers: string[],
    drivers: string[],
  ): string {
    const parts: string[] = [];

    parts.push(
      `Soroban Deployment Risk Score is ${compositeScore}/100 (${riskLevel.toUpperCase()}).`,
    );

    parts.push(
      `Category breakdown: Security ${breakdown.security.score}/100 (weight ${(breakdown.security.weight * 100).toFixed(0)}%), ` +
      `Resource ${breakdown.resource.score}/100 (weight ${(breakdown.resource.weight * 100).toFixed(0)}%), ` +
      `Deployment ${breakdown.deployment.score}/100 (weight ${(breakdown.deployment.weight * 100).toFixed(0)}%).`,
    );

    if (blockers.length > 0) {
      parts.push(`Deployment blocked by ${blockers.length} issue(s): ${blockers.join(' ')}`);
    } else if (compositeScore === 0) {
      parts.push('No risk factors detected. Contract appears clean and ready for deployment.');
    } else {
      parts.push('Contract risk is within acceptable parameters for deployment.');
    }

    return parts.join(' ');
  }

  private generateCategorySummary(
    category: RiskCategory,
    score: number,
    findingCount: number,
    highestSeverity: RiskSeverity | null,
  ): string {
    if (findingCount === 0) {
      return `No ${category} findings detected. Risk is minimal (0/100).`;
    }
    return `${findingCount} ${category} finding(s) detected with peak severity '${highestSeverity ?? 'none'}', contributing ${score}/100 to category risk.`;
  }

  private mergeConfig(custom: Partial<RiskWeightConfig>): RiskWeightConfig {
    const categories = {
      ...DEFAULT_CATEGORY_WEIGHTS,
      ...(custom.categories ?? {}),
    };

    // Normalize category weights to ensure sum = 1.0
    const catSum = categories.security + categories.resource + categories.deployment;
    if (catSum > 0 && Math.abs(catSum - 1.0) > 0.001) {
      categories.security = Number((categories.security / catSum).toFixed(4));
      categories.resource = Number((categories.resource / catSum).toFixed(4));
      categories.deployment = Number((categories.deployment / catSum).toFixed(4));
    }

    return {
      categories,
      severities: {
        ...DEFAULT_SEVERITY_POINTS,
        ...(custom.severities ?? {}),
      },
      levelThresholds: {
        ...DEFAULT_LEVEL_THRESHOLDS,
        ...(custom.levelThresholds ?? {}),
      },
      maxAcceptableScore: custom.maxAcceptableScore ?? DEFAULT_MAX_ACCEPTABLE_SCORE,
      customRuleWeights: {
        ...(custom.customRuleWeights ?? {}),
      },
    };
  }

  private validateConfig(config: RiskWeightConfig): void {
    for (const [cat, weight] of Object.entries(config.categories)) {
      if (weight < 0) {
        throw new Error(`Category weight for '${cat}' must be non-negative (got ${weight})`);
      }
    }
    for (const [sev, pts] of Object.entries(config.severities)) {
      if (pts < 0) {
        throw new Error(`Severity points for '${sev}' must be non-negative (got ${pts})`);
      }
    }
  }
}

// ── Standalone Utility Functions ─────────────────────────────────────────────

export function calculateDeploymentRiskScore(
  findings: Array<DeploymentRiskFinding | Record<string, any>>,
  config?: Partial<RiskWeightConfig>,
): DeploymentRiskScore {
  const analyzer = new SorobanDeploymentRiskAnalyzer(config);
  return analyzer.evaluateFindings(findings, config);
}

export function analyzeSorobanDeploymentRisk(
  source: string,
  contractPath?: string,
  config?: Partial<RiskWeightConfig>,
): DeploymentRiskScore {
  const analyzer = new SorobanDeploymentRiskAnalyzer(config);
  return analyzer.analyzeSource(source, contractPath, config);
}
