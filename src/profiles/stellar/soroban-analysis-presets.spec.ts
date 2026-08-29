import { SorobanAnalysisPresets } from './soroban-analysis-presets';

describe('SorobanAnalysisPresets', () => {
  let presets: SorobanAnalysisPresets;

  beforeEach(() => {
    presets = new SorobanAnalysisPresets();
  });

  it('should return all 3 preset names', () => {
    expect(presets.listPresetNames()).toEqual(expect.arrayContaining(['audit', 'optimization', 'security']));
  });

  describe('getPreset', () => {
    it('should return the audit preset with rules and severities', () => {
      const preset = presets.getPreset('audit');
      expect(preset.name).toBe('audit');
      expect(preset.rules.length).toBeGreaterThan(0);
      expect(preset.severity).toContain('critical');
    });

    it('should return the optimization preset with gas estimates enabled', () => {
      const preset = presets.getPreset('optimization');
      expect(preset.includeGasEstimates).toBe(true);
    });

    it('should return the security preset with only critical/high severity', () => {
      const preset = presets.getPreset('security');
      expect(preset.severity).toEqual(['critical', 'high']);
      expect(preset.includeGasEstimates).toBe(false);
    });
  });

  describe('applyPreset', () => {
    it('should return a result with applied rules and summary', () => {
      const result = presets.applyPreset('audit');
      expect(result.preset).toBe('audit');
      expect(result.appliedRules.length).toBeGreaterThan(0);
      expect(result.summary).toContain('audit');
    });
  });
});
