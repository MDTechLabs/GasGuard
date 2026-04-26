import { Controller, Post, Body, Get, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ScanService } from './scan.service';
import { ScanRequestDto, ScanResponseDto, ScanStatusDto } from './dto/scan.dto';

@ApiTags('scan')
@Controller('scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Perform real-time code scan' })
  @ApiBody({ type: ScanRequestDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Scan completed successfully',
    type: ScanResponseDto 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid scan request' 
  })
  async scanCode(@Body() scanRequest: ScanRequestDto): Promise<ScanResponseDto> {
    return this.scanService.performScan(scanRequest);
  }

  @Post('async')
  @ApiOperation({ summary: 'Start asynchronous scan' })
  @ApiBody({ type: ScanRequestDto })
  @ApiResponse({ 
    status: 202, 
    description: 'Scan started successfully',
    type: ScanStatusDto 
  })
  async startAsyncScan(@Body() scanRequest: ScanRequestDto): Promise<ScanStatusDto> {
    return this.scanService.startAsyncScan(scanRequest);
  }

  @Get('status/:scanId')
  @ApiOperation({ summary: 'Get scan status' })
  @ApiResponse({ 
    status: 200, 
    description: 'Scan status retrieved',
    type: ScanStatusDto 
  })
  async getScanStatus(@Query('scanId') scanId: string): Promise<ScanStatusDto> {
    return this.scanService.getScanStatus(scanId);
  }

  @Get('results/:scanId')
  @ApiOperation({ summary: 'Get scan results' })
  @ApiResponse({ 
    status: 200, 
    description: 'Scan results retrieved',
    type: ScanResponseDto 
  })
  async getScanResults(@Query('scanId') scanId: string): Promise<ScanResponseDto> {
    return this.scanService.getScanResults(scanId);
  }

  @Get('queue')
  @ApiOperation({ summary: 'Get scan queue status' })
  @ApiResponse({ 
    status: 200, 
    description: 'Queue status retrieved' 
  })
  async getQueueStatus() {
    return this.scanService.getQueueStatus();
  }

  @Post('cancel/:scanId')
  @ApiOperation({ summary: 'Cancel running scan' })
  @ApiResponse({ 
    status: 200, 
    description: 'Scan cancelled successfully' 
  })
  async cancelScan(@Query('scanId') scanId: string) {
    return this.scanService.cancelScan(scanId);
  }
}
