export interface CodebaseSubmissionRequest {
  project: {
    name: string;
    description?: string;
    repositoryUrl?: string;
    commitHash?: string;
  };
  files: FileSubmission[];
  options?: AnalysisOptions;
  metadata?: ProjectMetadata;
}

export interface FileSubmission {
  path: string;
  content: string;
  language: 'rust' | 'typescript' | 'javascript' | 'solidity';
  size: number;
  lastModified?: string;
}

export interface AnalysisOptions {
  scanType: 'security' | 'performance' | 'gas-optimization' | 'full';
  severity: 'low' | 'medium' | 'high' | 'critical';
  includeRecommendations: boolean;
  excludePatterns?: string[];
}

export interface ProjectMetadata {
  framework: 'soroban' | 'solidity' | 'general';
  version?: string;
  dependencies?: Record<string, string>;
  buildSystem?: 'cargo' | 'npm' | 'yarn' | 'hardhat';
  network?: 'stellar' | 'ethereum' | 'polygon' | 'bsc';
}

export interface AnalysisResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  submittedAt: string;
  estimatedDuration?: number;
  statusUrl: string;
  resultUrl: string;
}

export interface AnalysisStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep?: string;
  startedAt?: string;
  completedAt?: string;
  error?: AnalysisError;
}

export interface AnalysisResult {
  jobId: string;
  status: 'completed' | 'failed';
  completedAt: string;
  duration: number;
  summary: AnalysisSummary;
  files: FileAnalysisResult[];
  recommendations?: Recommendation[];
  metadata: ResultMetadata;
}

export interface AnalysisSummary {
  totalFiles: number;
  totalIssues: number;
  issuesBySeverity: Record<string, number>;
  issuesByType: Record<string, number>;
  gasSavings?: GasSavingsEstimate;
  securityScore?: number;
  performanceScore?: number;
}

export interface FileAnalysisResult {
  path: string;
  language: string;
  issues: Issue[];
  metrics: FileMetrics;
  scannedAt: string;
}

export interface Issue {
  id: string;
  type: 'security' | 'performance' | 'gas-optimization' | 'best-practice';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  location: {
    line: number;
    column?: number;
    function?: string;
  };
  rule: string;
  impact: string;
  recommendation?: string;
  codeExample?: {
    before: string;
    after: string;
  };
}

export interface FileMetrics {
  linesOfCode: number;
  complexity: number;
  functions: number;
  classes: number;
  gasUsage?: number;
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  estimatedImpact: string;
  implementation: {
    difficulty: 'easy' | 'medium' | 'hard';
    timeEstimate: string;
    codeChanges?: CodeChange[];
  };
}

export interface CodeChange {
  file: string;
  line: number;
  operation: 'replace' | 'insert' | 'delete';
  content: string;
}

export interface GasSavingsEstimate {
  totalGasSaved: number;
  percentageSaved: number;
  breakdown: Record<string, number>;
}

export interface ResultMetadata {
  scannerVersion: string;
  rulesVersion: string;
  analysisDuration: number;
  memoryUsage: number;
  framework: string;
}

export interface AnalysisError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  constraint: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    requestId: string;
  };
  validationErrors?: ValidationError[];
}
