import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { 
  ScanRequestDto, 
  ScanResponseDto, 
  ScanStatusDto, 
  ScanStatus, 
  QueueStatusDto,
  FindingDto,
  SummaryDto 
} from './dto/scan.dto';

// Severity enum
enum Severity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info'
}

// Simplified interfaces for now
interface Finding {
  ruleId: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
  estimatedGasSavings?: number;
  suggestedFix?: {
    description: string;
    codeSnippet?: string;
    documentationUrl?: string;
  };
  metadata?: Record<string, any>;
}

interface AnalysisResult {
  findings: Finding[];
  filesAnalyzed: number;
  analysisTime: number;
  analyzerVersion: string;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  totalEstimatedGasSavings?: number;
  errors?: Array<{
    file: string;
    message: string;
    error?: Error;
  }>;
}

@Injectable()
export class ScanService {
  private readonly activeScans = new Map<string, ScanStatusDto>();
  private readonly scanResults = new Map<string, ScanResponseDto>();

  constructor() {}

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async performScan(scanRequest: ScanRequestDto): Promise<ScanResponseDto> {
    const scanId = this.generateId();
    const startTime = Date.now();

    try {
      // Update status to running
      const status: ScanStatusDto = {
        scanId,
        status: ScanStatus.RUNNING,
        progress: 0,
        currentOperation: 'Initializing scan',
        lastUpdated: new Date().toISOString(),
        startedAt: new Date().toISOString()
      };
      this.activeScans.set(scanId, status);

      // Perform the actual scan
      const result = await this.executeScan(scanRequest, scanId);

      const analysisTime = Date.now() - startTime;

      // Convert to response format
      const response: ScanResponseDto = {
        scanId,
        status: ScanStatus.COMPLETED,
        findings: result.findings.map(this.convertFinding),
        summary: this.convertSummary(result.summary, result.findings),
        analysisTime,
        filesAnalyzed: result.filesAnalyzed,
        totalEstimatedGasSavings: result.totalEstimatedGasSavings,
        analyzerVersion: result.analyzerVersion,
        errors: result.errors?.map((err: any) => ({
          file: err.file,
          message: err.message,
          error: err.error?.message
        })),
        timestamp: new Date().toISOString()
      };

      this.scanResults.set(scanId, response);
      this.updateScanStatus(scanId, ScanStatus.COMPLETED, 100, 'Scan completed');

      return response;
    } catch (error) {
      this.updateScanStatus(scanId, ScanStatus.FAILED, 0, 'Scan failed', (error as Error).message);
      throw error;
    }
  }

  async startAsyncScan(scanRequest: ScanRequestDto): Promise<ScanStatusDto> {
    const scanId = this.generateId();

    const status: ScanStatusDto = {
      scanId,
      status: ScanStatus.PENDING,
      progress: 0,
      currentOperation: 'Queued for processing',
      lastUpdated: new Date().toISOString(),
      startedAt: new Date().toISOString()
    };

    this.activeScans.set(scanId, status);

    // For now, just perform the scan synchronously
    // In a real implementation, this would be queued
    setTimeout(async () => {
      try {
        await this.performScan(scanRequest);
      } catch (error) {
        this.updateScanStatus(scanId, ScanStatus.FAILED, 0, 'Scan failed', (error as Error).message);
      }
    }, 100);

    return status;
  }

  async getScanStatus(scanId: string): Promise<ScanStatusDto> {
    const status = this.activeScans.get(scanId);
    if (!status) {
      throw new NotFoundException(`Scan with ID ${scanId} not found`);
    }
    return status;
  }

  async getScanResults(scanId: string): Promise<ScanResponseDto> {
    const results = this.scanResults.get(scanId);
    if (!results) {
      const status = this.activeScans.get(scanId);
      if (!status) {
        throw new NotFoundException(`Scan with ID ${scanId} not found`);
      }
      if (status.status !== ScanStatus.COMPLETED) {
        throw new BadRequestException(`Scan ${scanId} has not completed yet`);
      }
      throw new NotFoundException(`Results for scan ${scanId} not found`);
    }
    return results;
  }

  async getQueueStatus(): Promise<QueueStatusDto> {
    const activeScans = Array.from(this.activeScans.values())
      .filter(status => status.status === ScanStatus.RUNNING).length;
    
    const completedScans = this.scanResults.size;
    const queueLength = Array.from(this.activeScans.values())
      .filter(status => status.status === ScanStatus.PENDING).length;

    // Mock values for now
    const averageProcessingTime = 30;
    const estimatedWaitTime = queueLength * averageProcessingTime;

    return {
      queueLength,
      activeScans,
      completedScans,
      averageProcessingTime,
      estimatedWaitTime
    };
  }

  async cancelScan(scanId: string): Promise<{ message: string }> {
    const status = this.activeScans.get(scanId);
    if (!status) {
      throw new NotFoundException(`Scan with ID ${scanId} not found`);
    }

    if (status.status === ScanStatus.COMPLETED) {
      throw new BadRequestException(`Scan ${scanId} has already completed`);
    }

    this.updateScanStatus(scanId, ScanStatus.CANCELLED, 0, 'Scan cancelled by user');

    return { message: `Scan ${scanId} cancelled successfully` };
  }

  private async executeScan(scanRequest: ScanRequestDto, scanId: string): Promise<AnalysisResult> {
    this.updateScanStatus(scanId, ScanStatus.RUNNING, 10, 'Parsing code');

    // Mock analyzer implementation - in real scenario, this would use the actual analyzer
    const mockFindings: Finding[] = await this.analyzeCode(scanRequest);

    this.updateScanStatus(scanId, ScanStatus.RUNNING, 80, 'Analyzing results');

    // Apply basic scoring
    const scoredFindings = mockFindings.map(finding => {
      const score = this.calculateBasicScore(finding);
      return {
        ...finding,
        metadata: {
          ...finding.metadata,
          score,
          riskLevel: this.getRiskLevel(score)
        }
      };
    });

    this.updateScanStatus(scanId, ScanStatus.RUNNING, 95, 'Finalizing results');

    return {
      findings: scoredFindings,
      filesAnalyzed: 1,
      analysisTime: 0, // Will be set by caller
      analyzerVersion: '1.0.0',
      summary: this.calculateSummary(scoredFindings),
      totalEstimatedGasSavings: this.calculateGasSavings(scoredFindings)
    };
  }

  private async analyzeCode(scanRequest: ScanRequestDto): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Add mock findings for demonstration
    findings.push(...this.getMockFindings(scanRequest));

    return findings;
  }

  private getMockFindings(scanRequest: ScanRequestDto): Finding[] {
    const findings: Finding[] = [];

    if (scanRequest.code.includes('require(msg.sender == owner)')) {
      findings.push({
        ruleId: 'inefficient-access-control',
        message: 'Inefficient access control pattern detected',
        severity: Severity.MEDIUM,
        location: {
          file: scanRequest.filePath || 'contract.sol',
          startLine: 1,
          endLine: 1
        },
        estimatedGasSavings: 2000,
        suggestedFix: {
          description: 'Use modifiers or role-based access control'
        }
      });
    }

    if (scanRequest.code.includes('.call(')) {
      findings.push({
        ruleId: 'unchecked-call',
        message: 'Unchecked external call detected',
        severity: Severity.HIGH,
        location: {
          file: scanRequest.filePath || 'contract.sol',
          startLine: 1,
          endLine: 1
        },
        estimatedGasSavings: 21000,
        suggestedFix: {
          description: 'Check return value of external calls'
        }
      });
    }

    return findings;
  }

  private updateScanStatus(
    scanId: string, 
    status: ScanStatus, 
    progress: number, 
    operation: string, 
    errorMessage?: string
  ): void {
    const currentStatus = this.activeScans.get(scanId);
    if (!currentStatus) return;

    const updatedStatus: ScanStatusDto = {
      ...currentStatus,
      status,
      progress,
      currentOperation: operation,
      lastUpdated: new Date().toISOString(),
      errorMessage,
      completedAt: (status === ScanStatus.COMPLETED || status === ScanStatus.FAILED || status === ScanStatus.CANCELLED) 
        ? new Date().toISOString() 
        : undefined
    };

    this.activeScans.set(scanId, updatedStatus);
  }

  private convertFinding(finding: Finding): FindingDto {
    return {
      ruleId: finding.ruleId,
      message: finding.message,
      severity: finding.severity,
      location: finding.location,
      estimatedGasSavings: finding.estimatedGasSavings,
      suggestedFix: finding.suggestedFix,
      score: finding.metadata?.score,
      riskLevel: finding.metadata?.riskLevel
    };
  }

  private convertSummary(summary: any, findings: Finding[]): SummaryDto {
    const totalScore = findings.reduce((sum, f) => sum + (f.metadata?.score || 0), 0);
    const riskLevel = this.getRiskLevel(totalScore / findings.length);
    
    return {
      critical: summary.critical || 0,
      high: summary.high || 0,
      medium: summary.medium || 0,
      low: summary.low || 0,
      info: summary.info || 0,
      totalScore,
      riskLevel
    };
  }

  private calculateSummary(findings: Finding[]): any {
    return {
      critical: findings.filter(f => f.severity === Severity.CRITICAL).length,
      high: findings.filter(f => f.severity === Severity.HIGH).length,
      medium: findings.filter(f => f.severity === Severity.MEDIUM).length,
      low: findings.filter(f => f.severity === Severity.LOW).length,
      info: findings.filter(f => f.severity === Severity.INFO).length
    };
  }

  private calculateGasSavings(findings: Finding[]): number {
    return findings
      .filter(f => f.estimatedGasSavings)
      .reduce((sum, f) => sum + (f.estimatedGasSavings || 0), 0);
  }

  private calculateBasicScore(finding: Finding): number {
    let score = 0;
    switch (finding.severity) {
      case 'critical':
        score = 90;
        break;
      case 'high':
        score = 70;
        break;
      case 'medium':
        score = 50;
        break;
      case 'low':
        score = 30;
        break;
      case 'info':
        score = 10;
        break;
    }
    
    if (finding.estimatedGasSavings) {
      score += Math.min(finding.estimatedGasSavings / 1000, 20); // Max 20 points for gas savings
    }
    
    return score;
  }

  private getRiskLevel(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }
}
