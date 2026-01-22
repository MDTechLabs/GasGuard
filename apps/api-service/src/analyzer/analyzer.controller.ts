import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service';
import { AnalyzeRequestDto } from './dto/analyze-request.dto';
import { AnalysisReport, StorageSavings } from './interfaces/analyzer.interface';

@Controller('analyzer')
export class AnalyzerController {
  constructor(private readonly analyzerService: AnalyzerService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyze(@Body() analyzeRequest: AnalyzeRequestDto): Promise<AnalysisReport> {
    return this.analyzerService.analyzeCode(
      analyzeRequest.code,
      analyzeRequest.source ?? 'remote-analysis',
    );
  }

  @Post('storage-savings')
  @HttpCode(HttpStatus.OK)
  async calculateStorageSavings(
    @Body() analyzeRequest: AnalyzeRequestDto,
  ): Promise<StorageSavings> {
    return this.analyzerService.calculateStorageSavings(analyzeRequest.code);
  }
}
