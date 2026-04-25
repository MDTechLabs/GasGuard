import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, SelectQueryBuilder } from 'typeorm';
import { GasSavings } from './entities/gas-savings.entity';
import { GasSavingsDto, ProjectSavingsDto, RuleSavingsDto, TimeSeriesSavingsDto } from './dto/gas-savings.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(GasSavings)
    private readonly gasSavingsRepository: Repository<GasSavings>,
  ) {}

  /**
   * Get total gas savings across all scans
   */
  async getTotalSavings(): Promise<number> {
    const result = await this.gasSavingsRepository
      .createQueryBuilder('gas_savings')
      .select('SUM(gas_savings.gasSaved)', 'total')
      .getRawOne();
    
    return result?.total ? parseInt(result.total) : 0;
  }

  /**
   * Get gas savings aggregated by project
   */
  async getSavingsByProject(): Promise<ProjectSavingsDto[]> {
    return this.gasSavingsRepository
      .createQueryBuilder('gas_savings')
      .select('gas_savings.projectId', 'projectId')
      .addSelect('COUNT(DISTINCT gas_savings.scanId)', 'scanCount')
      .addSelect('COUNT(*)', 'issueCount')
      .addSelect('SUM(gas_savings.gasSaved)', 'totalGasSaved')
      .groupBy('gas_savings.projectId')
      .orderBy('totalGasSaved', 'DESC')
      .getRawMany();
  }

  /**
   * Get gas savings aggregated by file within a project
   */
  async getSavingsByFile(projectId: string): Promise<any[]> {
    return this.gasSavingsRepository
      .createQueryBuilder('gas_savings')
      .select('gas_savings.fileName', 'fileName')
      .addSelect('COUNT(*)', 'issueCount')
      .addSelect('SUM(gas_savings.gasSaved)', 'totalGasSaved')
      .addSelect('AVG(gas_savings.severity)', 'averageSeverity')
      .where('gas_savings.projectId = :projectId', { projectId })
      .groupBy('gas_savings.fileName')
      .orderBy('totalGasSaved', 'DESC')
      .getRawMany();
  }

  /**
   * Get gas savings aggregated by rule
   */
  async getSavingsByRule(projectId?: string): Promise<RuleSavingsDto[]> {
    const query = this.gasSavingsRepository
      .createQueryBuilder('gas_savings')
      .select('gas_savings.ruleId', 'ruleId')
      .addSelect('gas_savings.ruleName', 'ruleName')
      .addSelect('COUNT(*)', 'applicationCount')
      .addSelect('SUM(gas_savings.gasSaved)', 'totalGasSaved')
      .addSelect('AVG(gas_savings.gasSaved)', 'averageGasSaved')
      .groupBy('gas_savings.ruleId, gas_savings.ruleName')
      .orderBy('totalGasSaved', 'DESC');

    if (projectId) {
      query.where('gas_savings.projectId = :projectId', { projectId });
    }

    return query.getRawMany();
  }

  /**
   * Get gas savings time series data
   */
  async getSavingsTimeSeries(
    projectId?: string,
    startDate?: Date,
    endDate?: Date,
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<TimeSeriesSavingsDto[]> {
    let query = this.gasSavingsRepository
      .createQueryBuilder('gas_savings');

    if (projectId) {
      query = query.where('gas_savings.projectId = :projectId', { projectId });
    }

    if (startDate && endDate) {
      query = query.andWhere('gas_savings.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });
    }

    const dateFormat = this.getDateFormat(granularity);

    return query
      .select(`DATE_FORMAT(gas_savings.createdAt, '${dateFormat}')`, 'timeBucket')
      .addSelect('COUNT(*)', 'issueCount')
      .addSelect('SUM(gas_savings.gasSaved)', 'totalGasSaved')
      .addSelect('COUNT(DISTINCT gas_savings.scanId)', 'scanCount')
      .groupBy(`DATE_FORMAT(gas_savings.createdAt, '${dateFormat}')`)
      .orderBy('timeBucket', 'ASC')
      .getRawMany();
  }

  /**
   * Get savings by severity level
   */
  async getSavingsBySeverity(projectId?: string): Promise<any[]> {
    const query = this.gasSavingsRepository
      .createQueryBuilder('gas_savings')
      .select('gas_savings.severity', 'severity')
      .addSelect('COUNT(*)', 'issueCount')
      .addSelect('SUM(gas_savings.gasSaved)', 'totalGasSaved')
      .groupBy('gas_savings.severity')
      .orderBy('severity', 'DESC');

    if (projectId) {
      query.where('gas_savings.projectId = :projectId', { projectId });
    }

    return query.getRawMany();
  }

  /**
   * Get top optimization opportunities
   */
  async getTopOptimizations(projectId?: string, limit: number = 10): Promise<any[]> {
    const query = this.gasSavingsRepository
      .createQueryBuilder('gas_savings')
      .select('gas_savings.fileName', 'fileName')
      .addSelect('gas_savings.ruleName', 'ruleName')
      .addSelect('gas_savings.description', 'description')
      .addSelect('gas_savings.gasSaved', 'gasSaved')
      .addSelect('gas_savings.lineNumber', 'lineNumber')
      .addSelect('gas_savings.severity', 'severity')
      .orderBy('gas_savings.gasSaved', 'DESC');

    if (projectId) {
      query.where('gas_savings.projectId = :projectId', { projectId });
    }

    return query.limit(limit).getRawMany();
  }

  /**
   * Get comprehensive dashboard data
   */
  async getDashboardData(projectId?: string): Promise<any> {
    const [
      totalSavings,
      projectSavings,
      ruleSavings,
      severityBreakdown,
      topOptimizations,
      recentActivity
    ] = await Promise.all([
      this.getTotalSavings(),
      this.getSavingsByProject(),
      this.getSavingsByRule(projectId),
      this.getSavingsBySeverity(projectId),
      this.getTopOptimizations(projectId, 5),
      this.getSavingsTimeSeries(projectId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date(), 'day')
    ]);

    return {
      overview: {
        totalSavings,
        totalProjects: projectSavings.length,
        totalRules: ruleSavings.length,
      },
      projectSavings: projectId ? projectSavings.filter(p => p.projectId === projectId) : projectSavings,
      ruleSavings,
      severityBreakdown: this.formatSeverityData(severityBreakdown),
      topOptimizations,
      recentActivity,
    };
  }

  /**
   * Record gas savings from a scan
   */
  async recordGasSavings(savings: GasSavingsDto[]): Promise<GasSavings[]> {
    const entities = savings.map(saving => {
      const entity = new GasSavings();
      entity.projectId = saving.projectId;
      entity.scanId = saving.scanId;
      entity.fileName = saving.fileName;
      entity.ruleId = saving.ruleId;
      entity.ruleName = saving.ruleName;
      entity.gasSaved = saving.gasSaved;
      entity.severity = saving.severity;
      entity.description = saving.description;
      entity.suggestion = saving.suggestion;
      entity.lineNumber = saving.lineNumber;
      return entity;
    });

    return this.gasSavingsRepository.save(entities);
  }

  private getDateFormat(granularity: string): string {
    switch (granularity) {
      case 'hour':
        return '%Y-%m-%d %H:00:00';
      case 'day':
        return '%Y-%m-%d';
      case 'week':
        return '%Y-%u';
      case 'month':
        return '%Y-%m';
      default:
        return '%Y-%m-%d';
    }
  }

  private formatSeverityData(severityData: any[]): any[] {
    const severityNames = ['Info', 'Warning', 'Error', 'Critical'];
    return severityData.map(item => ({
      ...item,
      severityName: severityNames[item.severity - 1] || 'Unknown',
    }));
  }
}
