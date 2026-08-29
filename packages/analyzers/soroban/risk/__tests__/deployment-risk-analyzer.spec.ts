import {
  analyzeSorobanDeploymentRisk,
  calculateDeploymentRiskScore,
  DEFAULT_CATEGORY_WEIGHTS,
  DEFAULT_SEVERITY_POINTS,
  SorobanDeploymentRiskAnalyzer,
} from '../deployment-risk-analyzer';
import { DeploymentRiskFinding, RiskWeightConfig } from '../types';

describe('SorobanDeploymentRiskAnalyzer (#932)', () => {
  let analyzer: SorobanDeploymentRiskAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanDeploymentRiskAnalyzer();
  });

  describe('Basic Risk Score Calculation', () => {
    it('returns a clean zero score for empty findings', () => {
      const result = analyzer.evaluateFindings([]);

      expect(result.compositeScore).toBe(0);
      expect(result.riskLevel).toBe('safe');
      expect(result.readyForDeployment).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.categoryBreakdown.security.score).toBe(0);
      expect(result.categoryBreakdown.resource.score).toBe(0);
      expect(result.categoryBreakdown.deployment.score).toBe(0);
      expect(result.rationale).toMatch(/no risk factors detected/i);
    });

    it('aggregates security findings into the security category', () => {
      const findings: DeploymentRiskFinding[] = [
        {
          id: 'sec-1',
          ruleId: 'soroban-missing-auth',
          category: 'security',
          severity: 'critical',
          message: 'Public state mutation missing caller authentication',
          suggestion: 'Add require_auth()',
          line: 25,
        },
      ];

      const result = analyzer.evaluateFindings(findings);

      expect(result.categoryBreakdown.security.findingCount).toBe(1);
      expect(result.categoryBreakdown.security.highestSeverity).toBe('critical');
      expect(result.categoryBreakdown.security.score).toBeGreaterThan(0);
      expect(result.categoryBreakdown.resource.score).toBe(0);
      expect(result.categoryBreakdown.deployment.score).toBe(0);
      // Critical security issue blocks deployment
      expect(result.readyForDeployment).toBe(false);
      expect(result.blockers.some((b) => b.includes('critical security finding'))).toBe(true);
    });

    it('aggregates resource findings into the resource category', () => {
      const findings: DeploymentRiskFinding[] = [
        {
          id: 'res-1',
          ruleId: 'soroban-unbounded-loop',
          category: 'resource',
          severity: 'high',
          message: 'Loop without iteration bound',
          suggestion: 'Bound loop iterations',
          line: 42,
        },
        {
          id: 'res-2',
          ruleId: 'soroban-memory-large-vec-allocation',
          category: 'resource',
          severity: 'medium',
          message: 'Large capacity vector allocation',
          suggestion: 'Use iterators',
          line: 60,
        },
      ];

      const result = analyzer.evaluateFindings(findings);

      expect(result.categoryBreakdown.resource.findingCount).toBe(2);
      expect(result.categoryBreakdown.resource.highestSeverity).toBe('high');
      expect(result.categoryBreakdown.resource.score).toBeGreaterThan(0);
      expect(result.categoryBreakdown.security.score).toBe(0);
      expect(result.categoryBreakdown.deployment.score).toBe(0);
    });

    it('aggregates deployment findings into the deployment category', () => {
      const findings: DeploymentRiskFinding[] = [
        {
          id: 'dep-1',
          ruleId: 'soroban-missing-instance-ttl-extension',
          category: 'deployment',
          severity: 'high',
          message: 'Persistent storage lacks TTL extension',
          suggestion: 'Call extend_ttl',
          line: 88,
        },
      ];

      const result = analyzer.evaluateFindings(findings);

      expect(result.categoryBreakdown.deployment.findingCount).toBe(1);
      expect(result.categoryBreakdown.deployment.highestSeverity).toBe('high');
      expect(result.categoryBreakdown.deployment.score).toBeGreaterThan(0);
    });

    it('aggregates mixed multi-category findings into a consolidated score', () => {
      const findings: DeploymentRiskFinding[] = [
        {
          id: '1',
          ruleId: 'soroban-missing-auth',
          category: 'security',
          severity: 'high',
          message: 'Missing auth check on privileged action',
          line: 12,
        },
        {
          id: '2',
          ruleId: 'soroban-cpu-nested-loop',
          category: 'resource',
          severity: 'high',
          message: 'Nested loops over contract state',
          line: 40,
        },
        {
          id: '3',
          ruleId: 'soroban-missing-upgrade-guard',
          category: 'deployment',
          severity: 'medium',
          message: 'Upgrade function lacks admin version check',
          line: 75,
        },
      ];

      const result = analyzer.evaluateFindings(findings);

      expect(result.categoryBreakdown.security.score).toBeGreaterThan(0);
      expect(result.categoryBreakdown.resource.score).toBeGreaterThan(0);
      expect(result.categoryBreakdown.deployment.score).toBeGreaterThan(0);
      expect(result.compositeScore).toBeGreaterThan(0);
      expect(result.compositeScore).toBeLessThanOrEqual(100);
      expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
    });
  });

  describe('Configurable Weighting', () => {
    it('applies custom category weights', () => {
      const customConfig: Partial<RiskWeightConfig> = {
        categories: {
          security: 0.80,
          resource: 0.10,
          deployment: 0.10,
        },
      };

      const customAnalyzer = new SorobanDeploymentRiskAnalyzer(customConfig);

      const securityFinding: DeploymentRiskFinding = {
        id: '1',
        ruleId: 'soroban-missing-auth',
        category: 'security',
        severity: 'high',
        message: 'Missing auth',
      };

      const defaultResult = analyzer.evaluateFindings([securityFinding]);
      const customResult = customAnalyzer.evaluateFindings([securityFinding]);

      // With 80% security weight, the composite score contribution should be higher
      expect(customResult.compositeScore).toBeGreaterThanOrEqual(defaultResult.compositeScore);
      expect(customResult.weights.categories.security).toBeCloseTo(0.80, 2);
    });

    it('applies custom severity point configurations', () => {
      const customConfig: Partial<RiskWeightConfig> = {
        severities: {
          critical: 150,
          high: 100,
          medium: 50,
          low: 20,
          info: 10,
        },
      };

      const customAnalyzer = new SorobanDeploymentRiskAnalyzer(customConfig);

      const finding: DeploymentRiskFinding = {
        id: '1',
        ruleId: 'soroban-missing-auth',
        category: 'security',
        severity: 'high',
        message: 'High severity issue',
      };

      const defaultResult = analyzer.evaluateFindings([finding]);
      const customResult = customAnalyzer.evaluateFindings([finding]);

      expect(customResult.categoryBreakdown.security.score).toBeGreaterThan(
        defaultResult.categoryBreakdown.security.score,
      );
    });

    it('applies custom rule weight multipliers', () => {
      const customConfig: Partial<RiskWeightConfig> = {
        customRuleWeights: {
          'soroban-missing-auth': 2.0,
        },
      };

      const customAnalyzer = new SorobanDeploymentRiskAnalyzer(customConfig);

      const finding: DeploymentRiskFinding = {
        id: '1',
        ruleId: 'soroban-missing-auth',
        category: 'security',
        severity: 'medium',
        message: 'Auth check',
      };

      const defaultResult = analyzer.evaluateFindings([finding]);
      const customResult = customAnalyzer.evaluateFindings([finding]);

      expect(customResult.categoryBreakdown.security.score).toBeGreaterThan(
        defaultResult.categoryBreakdown.security.score,
      );
    });

    it('normalizes category weights that do not sum to 1.0', () => {
      const customAnalyzer = new SorobanDeploymentRiskAnalyzer({
        categories: {
          security: 50,
          resource: 30,
          deployment: 20,
        },
      });

      const finding: DeploymentRiskFinding = {
        id: '1',
        ruleId: 'soroban-missing-auth',
        category: 'security',
        severity: 'high',
        message: 'Auth issue',
      };

      const result = customAnalyzer.evaluateFindings([finding]);
      const sum =
        result.weights.categories.security +
        result.weights.categories.resource +
        result.weights.categories.deployment;

      expect(sum).toBeCloseTo(1.0, 2);
    });
  });

  describe('Rule Auto-Categorization', () => {
    it('automatically categorizes findings without explicit category', () => {
      const rawFindings = [
        { ruleId: 'soroban-missing-auth', severity: 'high', message: 'Auth' },
        { ruleId: 'soroban-cpu-unbounded-loop', severity: 'high', message: 'Loop' },
        { ruleId: 'soroban-missing-instance-ttl-extension', severity: 'high', message: 'TTL' },
        { ruleId: 'soroban-custom-access-control', severity: 'medium', message: 'Access' },
        { ruleId: 'soroban-custom-gas-cost', severity: 'medium', message: 'Gas' },
      ];

      const result = analyzer.evaluateFindings(rawFindings);

      expect(result.categoryBreakdown.security.findingCount).toBe(2);
      expect(result.categoryBreakdown.resource.findingCount).toBe(2);
      expect(result.categoryBreakdown.deployment.findingCount).toBe(1);
    });
  });

  describe('Explainability & Reporting Rationale', () => {
    it('generates an explainable rationale and risk drivers', () => {
      const findings: DeploymentRiskFinding[] = [
        {
          id: '1',
          ruleId: 'soroban-missing-auth',
          category: 'security',
          severity: 'critical',
          message: 'Caller authorization missing on admin_transfer entrypoint',
          suggestion: 'Add require_auth()',
        },
        {
          id: '2',
          ruleId: 'soroban-unbounded-loop',
          category: 'resource',
          severity: 'high',
          message: 'Unbounded loop iterating over user addresses',
          suggestion: 'Paginate user list',
        },
      ];

      const result = analyzer.evaluateFindings(findings);

      expect(result.rationale).toContain('Soroban Deployment Risk Score is');
      expect(result.rationale).toContain('Category breakdown:');
      expect(result.primaryRiskDrivers.length).toBeGreaterThan(0);
      expect(result.primaryRiskDrivers.some((d) => d.includes('SECURITY') || d.includes('CRITICAL'))).toBe(true);
      expect(result.remediationSuggestions.length).toBeGreaterThan(0);
      expect(result.remediationSuggestions).toContain('Add require_auth()');
      expect(result.remediationSuggestions).toContain('Paginate user list');
    });

    it('sets readyForDeployment to false when score exceeds threshold', () => {
      const customAnalyzer = new SorobanDeploymentRiskAnalyzer({
        maxAcceptableScore: 10,
      });

      const findings: DeploymentRiskFinding[] = [
        {
          id: '1',
          ruleId: 'soroban-storage-in-loop',
          category: 'resource',
          severity: 'high',
          message: 'Ledger writes in loop',
        },
      ];

      const result = customAnalyzer.evaluateFindings(findings);

      expect(result.compositeScore).toBeGreaterThan(10);
      expect(result.readyForDeployment).toBe(false);
      expect(result.blockers.some((b) => b.includes('exceeds maximum acceptable threshold'))).toBe(true);
    });
  });

  describe('Direct Source Scanning', () => {
    it('detects deployment risk patterns in raw Soroban contract code', () => {
      const contractSource = `
        #![no_std]
        use soroban_sdk::{contract, contractimpl, Env, Address, Vec};

        #[contract]
        pub struct VulnerableContract;

        #[contractimpl]
        impl VulnerableContract {
            pub fn init(env: Env, admin: Address) {
                // Unprotected initialization
            }

            pub fn transfer_funds(env: Env, to: Address, amount: i128) {
                // Missing require_auth!
                env.storage().persistent().set(&to, &amount);
            }

            pub fn process_all(env: Env, items: Vec<Address>) {
                for item in items.iter() {
                    env.storage().persistent().set(&item, &1);
                }
            }

            pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
                // Missing upgrade guard
                env.deployer().update_current_contract_wasm(new_wasm_hash);
            }
        }
      `;

      const result = analyzer.analyzeSource(contractSource, 'contracts/vulnerable.rs');

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.categoryBreakdown.security.findingCount).toBeGreaterThan(0);
      expect(result.categoryBreakdown.resource.findingCount).toBeGreaterThan(0);
      expect(result.categoryBreakdown.deployment.findingCount).toBeGreaterThan(0);
      expect(result.readyForDeployment).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
    });

    it('evaluates clean contract source as safe', () => {
      const cleanSource = `
        #![no_std]
        use soroban_sdk::{contract, contractimpl, Env, Address};

        const VERSION: u32 = 1;

        #[contract]
        pub struct SafeContract;

        #[contractimpl]
        impl SafeContract {
            pub fn get_version(env: Env) -> u32 {
                VERSION
            }
        }
      `;

      const result = analyzer.analyzeSource(cleanSource, 'contracts/safe.rs');

      expect(result.compositeScore).toBeLessThan(30);
      expect(result.readyForDeployment).toBe(true);
    });
  });

  describe('Standalone Helper Functions', () => {
    it('calculates risk score with calculateDeploymentRiskScore helper', () => {
      const findings = [
        {
          ruleId: 'soroban-missing-auth',
          category: 'security' as const,
          severity: 'high' as const,
          message: 'Missing auth',
        },
      ];

      const result = calculateDeploymentRiskScore(findings);
      expect(result.compositeScore).toBeGreaterThan(0);
      expect(result.categoryBreakdown.security.findingCount).toBe(1);
    });

    it('analyzes source with analyzeSorobanDeploymentRisk helper', () => {
      const source = `
        pub fn admin_action(env: Env) {
            // no auth
        }
      `;

      const result = analyzeSorobanDeploymentRisk(source);
      expect(result).toBeDefined();
      expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    });
  });
});
