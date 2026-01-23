import { RuleViolation } from '../../scanner/interfaces/scanner.interface';
import { FindingMetadata } from '../../common/interfaces/finding-metadata.interface';

export interface FormattedViolation extends RuleViolation {
  severityIcon: string;
  formattedMessage: string;
  metadata?: FindingMetadata;
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

