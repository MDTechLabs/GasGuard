import { AnalysisPreset, PresetName, PresetResult } from './types';

const PRESETS: Record<PresetName, AnalysisPreset> = {
  audit: {
    name: 'audit',
    description: 'Comprehensive audit covering security, optimization, and correctness rules.',
    rules: ['no-unbounded-storage', 'auth-required', 'overflow-check', 'storage-efficiency', 'event-emission', 'reentrancy-guard'],
    severity: ['critical', 'high', 'medium', 'low', 'info'],
    maxFindings: 500,
    includeGasEstimates: true,
  },
  optimization: {
    name: 'optimization',
    description: 'Targets gas and resource usage optimizations for Soroban contracts.',
    rules: ['storage-efficiency', 'loop-optimization', 'redundant-computation', 'batch-operations'],
    severity: ['high', 'medium', 'low'],
    maxFindings: 200,
    includeGasEstimates: true,
  },
  security: {
    name: 'security',
    description: 'Focuses on critical and high-severity security vulnerabilities.',
    rules: ['auth-required', 'overflow-check', 'reentrancy-guard', 'unsafe-arithmetic', 'access-control'],
    severity: ['critical', 'high'],
    maxFindings: 100,
    includeGasEstimates: false,
  },
};

export class SorobanAnalysisPresets {
  getPreset(name: PresetName): AnalysisPreset {
    return PRESETS[name];
  }

  getAllPresets(): AnalysisPreset[] {
    return Object.values(PRESETS);
  }

  applyPreset(name: PresetName): PresetResult {
    const preset = this.getPreset(name);
    return {
      preset: preset.name,
      appliedRules: preset.rules,
      filteredSeverities: preset.severity,
      summary: `Preset '${preset.name}' applied: ${preset.rules.length} rules, severities [${preset.severity.join(', ')}], max ${preset.maxFindings} findings.`,
    };
  }

  listPresetNames(): PresetName[] {
    return Object.keys(PRESETS) as PresetName[];
  }
}
