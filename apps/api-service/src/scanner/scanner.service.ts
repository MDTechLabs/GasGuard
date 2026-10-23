import { Injectable, Logger } from "@nestjs/common";
import { RulesService } from "../rules/rules.service";
import { ScanResult, RuleViolation } from "./scanner.interface";
import { ScanRequestDto } from "./dto/scan-request.dto";
import {
  ArchiveLimitsConfig,
  ArchiveMetadata,
  assertArchiveSizeWithinLimits,
} from "./archive-size.util";

export type PolicySeverity = "error" | "warning" | "info";

export interface PolicyConfig {
  /** Fail when any violation has a severity at or above this level. */
  failOnSeverity?: PolicySeverity;
  /** Fail when any violation matches one of these rule identifiers. */
  failOnRules?: string[];
  /** Glob-like path prefixes; violations whose source starts with one of these fail the policy. */
  failOnPaths?: string[];
  /** Fail when the total number of violations exceeds this count. */
  maxFindings?: number;
  /** Fail when the number of error-severity violations exceeds this count. */
  maxErrors?: number;
}

export interface PolicyEvaluationResult {
  passed: boolean;
  failures: string[];
  evaluatedAt: string;
}

const SEVERITY_RANK: Record<PolicySeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);

  constructor(private readonly rulesService: RulesService) {}

  async scanContent(code: string, source: string): Promise<ScanResult> {
    const startTime = Date.now();
    const violations = await this.rulesService.analyze(code);
    const scanDuration = Date.now() - startTime;

    return {
      source,
      violations,
      scanTime: new Date().toISOString(),
      scanDurationMs: scanDuration,
      hasViolations: violations.length > 0,
      summary: this.generateSummary(violations),
    };
  }

  async scanBatch(requests: ScanRequestDto[]): Promise<ScanResult[]> {
    const results = await Promise.all(
      requests.map((req) =>
        this.scanContent(req.code, req.source ?? "remote-scan"),
      ),
    );
    return results;
  }

  /**
   * Evaluates scan results against a configurable policy. Returns a result
   * indicating whether the build should pass, with human-readable failure reasons.
   */
  evaluatePolicy(
    results: ScanResult[],
    policy: PolicyConfig,
  ): PolicyEvaluationResult {
    const failures: string[] = [];
    const allViolations: RuleViolation[] = results.flatMap(
      (r) => r.violations,
    );

    if (policy.failOnSeverity) {
      const threshold = SEVERITY_RANK[policy.failOnSeverity];
      const matching = allViolations.filter(
        (v) => SEVERITY_RANK[v.severity as PolicySeverity] >= threshold,
      );
      if (matching.length > 0) {
        failures.push(
          `${matching.length} violation(s) at or above severity "${policy.failOnSeverity}"`,
        );
      }
    }

    if (policy.failOnRules && policy.failOnRules.length > 0) {
      const blocked = new Set(policy.failOnRules);
      const matching = allViolations.filter((v) => blocked.has(v.rule));
      if (matching.length > 0) {
        const ids = [...new Set(matching.map((v) => v.rule))].join(", ");
        failures.push(`Blocked rule(s) triggered: ${ids}`);
      }
    }

    if (policy.failOnPaths && policy.failOnPaths.length > 0) {
      for (const result of results) {
        const hit = policy.failOnPaths.find((prefix) =>
          result.source.startsWith(prefix),
        );
        if (hit && result.violations.length > 0) {
          failures.push(
            `${result.violations.length} violation(s) under restricted path "${hit}" (source: ${result.source})`,
          );
        }
      }
    }

    if (
      policy.maxFindings !== undefined &&
      allViolations.length > policy.maxFindings
    ) {
      failures.push(
        `Finding count ${allViolations.length} exceeds maximum ${policy.maxFindings}`,
      );
    }

    if (policy.maxErrors !== undefined) {
      const errorCount = allViolations.filter(
        (v) => v.severity === "error",
      ).length;
      if (errorCount > policy.maxErrors) {
        failures.push(
          `Error count ${errorCount} exceeds maximum ${policy.maxErrors}`,
        );
      }
    }

    const evaluation: PolicyEvaluationResult = {
      passed: failures.length === 0,
      failures,
      evaluatedAt: new Date().toISOString(),
    };

    if (!evaluation.passed) {
      this.logger.warn(`Policy evaluation failed: ${failures.join("; ")}`);
    }

    return evaluation;
  }

  /**
   * Validates the size of an uploaded archive against configured limits.
   * Throws ArchiveLimitError when any limit is violated.
   */
  validateArchiveUpload(
    metadata: ArchiveMetadata,
    config: Partial<ArchiveLimitsConfig> = {},
  ): void {
    try {
      assertArchiveSizeWithinLimits(metadata, config);
      this.logger.log(
        `Archive upload validated successfully (${metadata.archiveBytes} bytes): ${
          metadata.entries ?? "unknown"
        } entries`,
      );
    } catch (error) {
      if (error instanceof Error) {
        this.logger.warn(`Archive upload rejected: ${error.message}`);
      }
      throw error;
    }
  }

  private generateSummary(violations: RuleViolation[]): {
    total: number;
    errors: number;
    warnings: number;
    info: number;
  } {
    const summary = {
      total: violations.length,
      errors: 0,
      warnings: 0,
      info: 0,
    };

    for (const violation of violations) {
      switch (violation.severity) {
        case "error":
          summary.errors++;
          break;
        case "warning":
          summary.warnings++;
          break;
        case "info":
          summary.info++;
          break;
      }
    }

    return summary;
  }
}
