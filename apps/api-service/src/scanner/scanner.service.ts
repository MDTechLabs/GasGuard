import { Injectable } from '@nestjs/common';
import { RulesService } from '../rules/rules.service';
import { ScanResult, RuleViolation } from './interfaces/scanner.interface';
import { ScanRequestDto } from './dto/scan-request.dto';

@Injectable()
export class ScannerService {
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
        this.scanContent(req.code, req.source ?? 'remote-scan'),
      ),
    );
    return results;
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
        case 'error':
          summary.errors++;
          break;
        case 'warning':
          summary.warnings++;
          break;
        case 'info':
          summary.info++;
          break;
      }
    }

    return summary;
  }
}
