import { RuleViolation } from '../../scanner/interfaces/scanner.interface';

export interface FormattedViolation extends RuleViolation {
  severityIcon: string;
  formattedMessage: string;
}

export interface StorageSavings {
  unusedVariables: number;
  estimatedSavingsKb: number;
  monthlyLedgerRentSavings: number;
}

export interface AnalysisReport {
  source: string;
  analysisTime: string;
  violations: FormattedViolation[];
  summary: string;
  storageSavings: StorageSavings;
  recommendations: string[];
}
