export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  functionCount: number;
  branchCount: number;
  loopCount: number;
  recursionDepth: number;
  nestingDepth: number;
}

export interface FunctionComplexity {
  name: string;
  line: number;
  metrics: ComplexityMetrics;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

export interface ComplexityReport {
  contractName: string;
  functions: FunctionComplexity[];
  totalComplexity: number;
  averageComplexity: number;
  highestComplexity: FunctionComplexity | null;
  riskBreakdown: { low: number; medium: number; high: number; critical: number };
  summary: string;
}

export interface ComplexityConfig {
  thresholds: { low: number; medium: number; high: number };
  includePrivate: boolean;
}
