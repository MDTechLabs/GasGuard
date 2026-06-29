export type PresetName = 'audit' | 'optimization' | 'security';

export interface AnalysisPreset {
  name: PresetName;
  description: string;
  rules: string[];
  severity: ('critical' | 'high' | 'medium' | 'low' | 'info')[];
  maxFindings: number;
  includeGasEstimates: boolean;
}

export interface PresetResult {
  preset: PresetName;
  appliedRules: string[];
  filteredSeverities: string[];
  summary: string;
}
