import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { ScannerService } from "./scanner.service";
import { ScanRequestDto } from "./dto/scan-request.dto";
import { ScanResult } from "./interfaces/scanner.interface";
import {
  ArchiveLimitError,
  ArchiveLimitsConfig,
  ArchiveMetadata,
} from "./archive-size.util";

@Controller("scanner")
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Post("scan")
  @HttpCode(HttpStatus.OK)
  async scanCode(@Body() scanRequest: ScanRequestDto): Promise<ScanResult> {
    return this.scannerService.scanContent(
      scanRequest.code,
      scanRequest.source ?? "remote-scan",
    );
  }

  @Post("scan-batch")
  @HttpCode(HttpStatus.OK)
  async scanBatch(
    @Body() scanRequests: ScanRequestDto[],
  ): Promise<ScanResult[]> {
    return this.scannerService.scanBatch(scanRequests);
  }

  @Post("validate-archive")
  @HttpCode(HttpStatus.OK)
  validateArchive(
    @Body()
    body: ArchiveMetadata & { limits?: Partial<ArchiveLimitsConfig> },
  ): { valid: true } {
    try {
      this.scannerService.validateArchiveUpload(body, body.limits ?? {});
      return { valid: true };
    } catch (error) {
      if (error instanceof ArchiveLimitError) {
        throw new BadRequestException({
          message: error.message,
          violations: error.violations,
        });
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid archive metadata",
      );
    }
  }
}
