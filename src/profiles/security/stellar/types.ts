export interface SecurityCheck {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'access-control' | 'input-validation' | 'crypto' | 'storage' | 'logic' | 'dependency';
  passed: boolean;
  details: string;
  recommendation: string;
}

export interface SecurityProfileResult {
  profileName: string;
  contractName: string;
  checks: SecurityCheck[];
  passedCount: number;
  failedCount: number;
  overallScore: number;
  criticalIssues: SecurityCheck[];
  summary: string;
}

export interface SecurityProfileConfig {
  strictMode: boolean;
  failOnCritical: boolean;
  customChecks: SecurityCheck[];
}
