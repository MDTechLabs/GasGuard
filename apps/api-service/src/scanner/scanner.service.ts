import { Injectable, Logger } from "@nestjs/common";
import { RulesService } from "../rules/rules.service";
import { ScanResult, RuleViolation } from "./scanner.interface";
import { ScanRequestDto } from "./dto/scan-request.dto";
import {
  ArchiveLimitsConfig,
  ArchiveMetadata,
  assertArchiveSizeWithinLimits,
} from "./archive-size.util";

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
        } entries),
      );
    } catch (error) {
      if (error instanceof Error) {
        this.logger.warn(
          `Archive upload rejected: ${error.message}`,
        );
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
