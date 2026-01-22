import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScanRequestDto } from './dto/scan-request.dto';
import { ScanResult } from './interfaces/scanner.interface';

@Controller('scanner')
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  async scanCode(@Body() scanRequest: ScanRequestDto): Promise<ScanResult> {
    return this.scannerService.scanContent(
      scanRequest.code,
      scanRequest.source ?? 'remote-scan',
    );
  }

  @Post('scan-batch')
  @HttpCode(HttpStatus.OK)
  async scanBatch(
    @Body() scanRequests: ScanRequestDto[],
  ): Promise<ScanResult[]> {
    return this.scannerService.scanBatch(scanRequests);
  }
}
