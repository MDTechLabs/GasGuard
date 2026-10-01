import { logger } from '../utils/logger';

export interface PolicyRuleDefinition {
  policyId: string;
  version: string;
  rules: {
    maxGasLimit: number;
    allowlistEnabled: boolean;
    restrictedOpcodes?: string[];
  };
  createdAt: number;
}

// Storage map: policyId -> Map<version, PolicyRuleDefinition>
const policyVersionRegistry = new Map<string, Map<string, PolicyRuleDefinition>>();

export class PolicyVersioningService {
  /**
   * Register a specific version of a policy
   */
  static registerPolicyVersion(policyId: string, version: string, rules: PolicyRuleDefinition['rules']): PolicyRuleDefinition {
    if (!policyVersionRegistry.has(policyId)) {
      policyVersionRegistry.set(policyId, new Map());
    }

    const versionMap = policyVersionRegistry.get(policyId)!;
    const policyDef: PolicyRuleDefinition = {
      policyId,
      version,
      rules,
      createdAt: Date.now(),
    };

    versionMap.set(version, policyDef);
    logger.info({ policyId, version }, 'Registered new policy version');
    return policyDef;
  }

  /**
   * Retrieve a specific policy version or the latest version if unpinned
   */
  static getPolicy(policyId: string, version?: string): PolicyRuleDefinition {
    const versionMap = policyVersionRegistry.get(policyId);
    if (!versionMap || versionMap.size === 0) {
      throw new Error(`Policy ${policyId} not found in registry`);
    }

    if (version && version !== 'latest') {
      const policyDef = versionMap.get(version);
      if (!policyDef) {
        throw new Error(`Policy ${policyId} version ${version} not found`);
      }
      return policyDef;
    }

    // Default to latest version (highest timestamp or lexicographical order)
    const sortedVersions = Array.from(versionMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    return sortedVersions[0];
  }

  /**
   * Evaluate transaction payload against a pinned or latest policy version
   */
  static evaluatePolicy(policyId: string, payload: { gasLimit: number; opcodes?: string[] }, pinnedVersion?: string): { compliant: boolean; versionUsed: string; reason?: string } {
    const policy = this.getPolicy(policyId, pinnedVersion);

    if (payload.gasLimit > policy.rules.maxGasLimit) {
      return {
        compliant: false,
        versionUsed: policy.version,
        reason: `Gas limit ${payload.gasLimit} exceeds maximum allowed (${policy.rules.maxGasLimit}) for policy version ${policy.version}`,
      };
    }

    return {
      compliant: true,
      versionUsed: policy.version,
    };
  }
}