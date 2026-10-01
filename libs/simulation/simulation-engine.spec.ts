import { SimulationEngine, PolicySimulationConfig } from './simulation-engine';
import { ChainAdapter, SimulationResult } from '@chains/base-adapter';

// Mock ChainAdapter for testing
class MockChainAdapter implements ChainAdapter {
  async simulate(code: string, method: string, params: any[]): Promise<SimulationResult> {
    return {
      gasUsed: 100000,
      success: true,
      returnValue: '0x1234',
      opcodes: [
        { opcode: 'PUSH1', gas: 3 },
        { opcode: 'ADD', gas: 3 },
      ],
    };
  }
}

describe('SimulationEngine - Policy Simulation Mode', () => {
  let engine: SimulationEngine;
  let mockAdapter: MockChainAdapter;

  beforeEach(() => {
    mockAdapter = new MockChainAdapter();
    engine = new SimulationEngine(mockAdapter);
  });

  describe('setPolicySimulationMode', () => {
    it('should enable policy simulation mode', () => {
      const config: PolicySimulationConfig = {
        simulationMode: true,
        policyRules: ['rule1', 'rule2'],
      };

      engine.setPolicySimulationMode(config);

      expect(engine.isPolicySimulationMode()).toBe(true);
    });

    it('should disable policy simulation mode', () => {
      const config: PolicySimulationConfig = {
        simulationMode: false,
      };

      engine.setPolicySimulationMode(config);

      expect(engine.isPolicySimulationMode()).toBe(false);
    });

    it('should handle empty policy rules array', () => {
      const config: PolicySimulationConfig = {
        simulationMode: true,
        policyRules: [],
      };

      engine.setPolicySimulationMode(config);

      expect(engine.isPolicySimulationMode()).toBe(true);
    });

    it('should handle undefined policy rules', () => {
      const config: PolicySimulationConfig = {
        simulationMode: true,
      };

      engine.setPolicySimulationMode(config);

      expect(engine.isPolicySimulationMode()).toBe(true);
    });
  });

  describe('isPolicySimulationMode', () => {
    it('should return false by default', () => {
      expect(engine.isPolicySimulationMode()).toBe(false);
    });

    it('should return true when simulation mode is enabled', () => {
      engine.setPolicySimulationMode({ simulationMode: true });
      expect(engine.isPolicySimulationMode()).toBe(true);
    });
  });

  describe('simulateExecution', () => {
    it('should return standard SimulationResult when simulation mode is disabled', async () => {
      const result = await engine.simulateExecution('contract code', 'method', ['param1']);

      expect(result).toHaveProperty('gasUsed');
      expect(result).toHaveProperty('success');
      expect(result).not.toHaveProperty('isSimulation');
      expect(result).not.toHaveProperty('policyViolations');
    });

    it('should return PolicySimulationResult when simulation mode is enabled', async () => {
      engine.setPolicySimulationMode({ simulationMode: true });

      const result = await engine.simulateExecution('contract code', 'method', ['param1']);

      expect(result).toHaveProperty('gasUsed');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('isSimulation', true);
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('policyViolations');
    });
  });

  describe('simulateWithPolicy', () => {
    it('should enable simulation mode and return PolicySimulationResult', async () => {
      const config: PolicySimulationConfig = {
        simulationMode: true,
        includePolicyDetails: true,
      };

      const result = await engine.simulateWithPolicy('contract code', 'method', ['param1'], config);

      expect(result.isSimulation).toBe(true);
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('policyViolations');
      expect(Array.isArray(result.policyViolations)).toBe(true);
    });

    it('should use default config when none provided', async () => {
      const result = await engine.simulateWithPolicy('contract code', 'method', ['param1']);

      expect(result.isSimulation).toBe(true);
      expect(engine.isPolicySimulationMode()).toBe(true);
    });

    it('should analyze policy violations for code with transfer without auth', async () => {
      const code = 'function transfer() { /* transfer logic */ }';
      const config: PolicySimulationConfig = {
        simulationMode: true,
        policyRules: ['auth-check'],
      };

      const result = await engine.simulateWithPolicy(code, 'transfer', [], config);

      expect(result.policyViolations).toBeDefined();
      expect(result.policyViolations!.length).toBeGreaterThan(0);
      expect(result.policyViolations![0].ruleId).toBe('auth-check');
    });

    it('should not detect violations for code with transfer and auth', async () => {
      const code = 'function transfer() { require_auth(); /* transfer logic */ }';
      const config: PolicySimulationConfig = {
        simulationMode: true,
        policyRules: ['auth-check'],
      };

      const result = await engine.simulateWithPolicy(code, 'transfer', [], config);

      expect(result.policyViolations).toBeDefined();
      // Should not have auth-check violation since require_auth is present
      const authViolations = result.policyViolations!.filter(v => v.ruleId === 'auth-check');
      expect(authViolations.length).toBe(0);
    });

    it('should handle empty code without errors', async () => {
      const config: PolicySimulationConfig = {
        simulationMode: true,
      };

      const result = await engine.simulateWithPolicy('', 'method', [], config);

      expect(result.isSimulation).toBe(true);
      expect(result.policyViolations).toBeDefined();
    });
  });

  describe('compareOptimizations', () => {
    it('should work correctly regardless of simulation mode', async () => {
      engine.setPolicySimulationMode({ simulationMode: true });

      const report = await engine.compareOptimizations(
        'original code',
        'optimized code',
        'method',
        ['param1'],
      );

      expect(report).toHaveProperty('before');
      expect(report).toHaveProperty('after');
      expect(report).toHaveProperty('gasSaved');
      expect(report).toHaveProperty('percentageImprovement');
      expect(report).toHaveProperty('opcodeDiff');
    });
  });
});
