/**
 * Impact Scoring Types for Soroban/Stellar Findings
 *
 * Defines the type system for assigning impact scores to findings
 * beyond severity, including exploitability, reachability,
 * value-at-risk, and business impact dimensions.
 */

export enum ImpactCategory {
  EXPLOITABILITY = 'exploitability',
  REACHABILITY = 'reachability',
  VALUE_AT_RISK = 'value-at-risk',
  BUSINESS_IMPACT = 'business-impact',
  GAS_EFFICIENCY = 'gas-efficiency',
  CODE_QUALITY = 'code-quality',
}

export interface ImpactFactor {
  category: ImpactCategory;
  score: number;
  weight: number;
  description: string;
  evidence?: string;
}

export interface ImpactScore {
  overall: number;
  impactLevel: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
  factors: ImpactFactor[];
  exploitability: number;
  reachability: number;
  valueAtRisk: number;
  businessImpact: number;
}

export interface ImpactReport {
  findingId: string;
  ruleId: string;
  message: string;
  severity: string;
  impactScore: ImpactScore;
  perCategoryBreakdown: Record<ImpactCategory, number>;
  recommendations: string[];
  generatedAt: string;
}

export interface ImpactScoringConfig {
  weights?: Partial<Record<ImpactCategory, number>>;
  thresholds?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  exploitabilityFactors?: {
    requiresAuthBypass: number;
    requiresPreviousState: number;
    requiresUserInteraction: number;
    directExploit: number;
  };
}
