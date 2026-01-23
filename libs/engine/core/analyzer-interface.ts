
export enum Severity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
}


export interface Finding {
  ruleId: string;
  message: string;
  severity: Severity;
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


export interface Rule {
  
  id: string;
  name: string;
  description: string;
  severity: Severity;
  category: string;
  enabled: boolean;
  tags?: string[];
  documentationUrl?: string;
  
 
  estimatedGasImpact?: {
    min: number;
    max: number;
    typical: number;
  };
}

export interface AnalyzerConfig {
  rules?: {
    [ruleId: string]: boolean | {
      enabled: boolean;
      severity?: Severity;
      options?: Record<string, any>;
    };
  };
  
  
  excludePaths?: string[];
  includePaths?: string[];
  maxFindings?: number;
  options?: Record<string, any>;
}


export interface AnalysisResult {
 
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
  
  /** Any errors or warnings during analysis */
  errors?: Array<{
    file: string;
    message: string;
    error?: Error;
  }>;
}

export enum Language {
  SOLIDITY = 'solidity',
  VYPER = 'vyper',
  RUST = 'rust',
  SOROBAN = 'soroban',
  CAIRO = 'cairo',
  MOVE = 'move',
  JAVASCRIPT = 'javascript',
  TYPESCRIPT = 'typescript',
}


export interface Analyzer {
 
  getName(): string;
  getVersion(): string;
  
  analyze(
    code: string,
    filePath: string,
    config?: AnalyzerConfig
  ): Promise<AnalysisResult>;
  
 
  analyzeMultiple(
    files: Map<string, string>,
    config?: AnalyzerConfig
  ): Promise<AnalysisResult>;
  
 
  supportsLanguage(language: Language | string): boolean;
  
 
  getSupportedLanguages(): Language[];
  
  
  getRules(): Rule[];
  
 
  getRule(ruleId: string): Rule | undefined;
  
 
  validateConfig(config: AnalyzerConfig): string[];
  
 
  initialize(config?: AnalyzerConfig): Promise<void>;
  
  
  dispose(): Promise<void>;
}


export abstract class BaseAnalyzer implements Analyzer {
  protected config: AnalyzerConfig = {};
  protected initialized = false;
  
  abstract getName(): string;
  abstract getVersion(): string;
  abstract analyze(code: string, filePath: string, config?: AnalyzerConfig): Promise<AnalysisResult>;
  abstract supportsLanguage(language: Language | string): boolean;
  abstract getSupportedLanguages(): Language[];
  abstract getRules(): Rule[];
  
 
  async analyzeMultiple(
    files: Map<string, string>,
    config?: AnalyzerConfig
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const allFindings: Finding[] = [];
    const errors: Array<{ file: string; message: string; error?: Error }> = [];
    
    for (const [filePath, code] of files.entries()) {
      try {
        const result = await this.analyze(code, filePath, config);
        allFindings.push(...result.findings);
        if (result.errors) {
          errors.push(...result.errors);
        }
      } catch (error) {
        errors.push({
          file: filePath,
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error : undefined,
        });
      }
    }
    
    const analysisTime = Date.now() - startTime;
    
    return {
      findings: allFindings,
      filesAnalyzed: files.size,
      analysisTime,
      analyzerVersion: this.getVersion(),
      summary: this.calculateSummary(allFindings),
      totalEstimatedGasSavings: this.calculateTotalGasSavings(allFindings),
      errors: errors.length > 0 ? errors : undefined,
    };
  }
  
  getRule(ruleId: string): Rule | undefined {
    return this.getRules().find(rule => rule.id === ruleId);
  }
  
  validateConfig(config: AnalyzerConfig): string[] {
    const errors: string[] = [];
    
    if (config.rules) {
      const availableRules = new Set(this.getRules().map(r => r.id));
      for (const ruleId of Object.keys(config.rules)) {
        if (!availableRules.has(ruleId)) {
          errors.push(`Unknown rule: ${ruleId}`);
        }
      }
    }
    
    return errors;
  }
  
  async initialize(config?: AnalyzerConfig): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (config) {
      const errors = this.validateConfig(config);
      if (errors.length > 0) {
        throw new Error(`Invalid configuration: ${errors.join(', ')}`);
      }
      this.config = config;
    }
    
    this.initialized = true;
  }
  
  async dispose(): Promise<void> {
    this.initialized = false;
  }
  
 
  protected calculateSummary(findings: Finding[]): AnalysisResult['summary'] {
    return {
      critical: findings.filter(f => f.severity === Severity.CRITICAL).length,
      high: findings.filter(f => f.severity === Severity.HIGH).length,
      medium: findings.filter(f => f.severity === Severity.MEDIUM).length,
      low: findings.filter(f => f.severity === Severity.LOW).length,
      info: findings.filter(f => f.severity === Severity.INFO).length,
    };
  }
  
 
  protected calculateTotalGasSavings(findings: Finding[]): number | undefined {
    const savings = findings
      .map(f => f.estimatedGasSavings || 0)
      .reduce((sum, val) => sum + val, 0);
    
    return savings > 0 ? savings : undefined;
  }
  
 
  protected shouldAnalyzeFile(filePath: string, config?: AnalyzerConfig): boolean {
    const cfg = config || this.config;
    
    if (cfg.excludePaths) {
      for (const pattern of cfg.excludePaths) {
        if (this.matchesPattern(filePath, pattern)) {
          return false;
        }
      }
    }
    
    if (cfg.includePaths && cfg.includePaths.length > 0) {
      let matches = false;
      for (const pattern of cfg.includePaths) {
        if (this.matchesPattern(filePath, pattern)) {
          matches = true;
          break;
        }
      }
      return matches;
    }
    
    return true;
  }
  
  private matchesPattern(path: string, pattern: string): boolean {
    // Simple implementation - can be enhanced with glob patterns
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(path);
    }
    return path.includes(pattern);
  }
}