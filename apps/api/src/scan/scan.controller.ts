import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ScanService } from './scan.service';
import { ScanResult, ScanError } from './interfaces/scan.interface';

interface ScanRequestDto {
  contractCode: string;
  timeoutMs?: number;
  options?: Record<string, unknown>;
}

@Controller('scan')
export class ScanController {
  private readonly logger = new Logger(ScanController.name);

  constructor(private readonly scanService: ScanService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async scanContract(
    @Body() scanRequest: ScanRequestDto,
  ): Promise<ScanResult | { error: ScanError }> {
    try {
      // Validate input
      if (!scanRequest.contractCode || typeof scanRequest.contractCode !== 'string') {
        throw new BadRequestException({
          code: 'INVALID_INPUT',
          message: 'contractCode is required and must be a string',
        });
      }

      if (scanRequest.contractCode.length === 0) {
        throw new BadRequestException({
          code: 'INVALID_INPUT',
          message: 'contractCode cannot be empty',
        });
      }

      this.logger.log(
        `Received scan request (code length: ${scanRequest.contractCode.length} chars)`,
      );

      // Execute scan with timeout protection
      const result = await this.scanService.executeScan(
        scanRequest.contractCode,
        {
          timeoutMs: scanRequest.timeoutMs,
        },
      );

      return result;
    } catch (error) {
      this.logger.error('Scan request failed:', error);

      // Handle timeout errors specifically
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'SCAN_TIMEOUT'
      ) {
        throw new RequestTimeoutException({
          error: error as ScanError,
          message: `Scan exceeded maximum execution time. ${error.message}`,
        });
      }

      // Handle validation errors
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle other errors
      throw {
        error: {
          code: 'SCAN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        } as ScanError,
      };
    }
  }
}
