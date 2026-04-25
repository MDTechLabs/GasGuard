export class GasSavingsDto {
  projectId: string;
  scanId: string;
  fileName: string;
  ruleId: string;
  ruleName: string;
  gasSaved: number;
  severity: number;
  description?: string;
  suggestion?: string;
  lineNumber: number;
}

export class ProjectSavingsDto {
  projectId: string;
  scanCount: number;
  issueCount: number;
  totalGasSaved: number;
}

export class RuleSavingsDto {
  ruleId: string;
  ruleName: string;
  applicationCount: number;
  totalGasSaved: number;
  averageGasSaved: number;
}

export class TimeSeriesSavingsDto {
  timeBucket: string;
  issueCount: number;
  totalGasSaved: number;
  scanCount: number;
}

export class DashboardQueryDto {
  projectId?: string;
  startDate?: string;
  endDate?: string;
  granularity?: 'hour' | 'day' | 'week' | 'month';
  limit?: number;
}
