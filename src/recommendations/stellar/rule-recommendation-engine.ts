/**
 * Soroban/Stellar Rule Recommendation Engine (#471)
 *
 * Recommends specific Soroban security/optimization rules based on contract source code characteristics.
 */

export interface RuleRecommendation {
  id: string;
  name: string;
  reason: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "security" | "gas-optimization" | "best-practices";
}

export interface RecommendationResult {
  detectedTraits: string[];
  recommendations: RuleRecommendation[];
}

export class SorobanRuleRecommendationEngine {
  /**
   * Recommend rules based on contract content analysis.
   */
  recommend(sourceCode: string): RecommendationResult {
    const detectedTraits: string[] = [];
    const recommendations: RuleRecommendation[] = [];

    // 1. Analyze traits
    if (sourceCode.includes("require_auth")) {
      detectedTraits.push("authorization");
    }
    if (sourceCode.includes("storage().instance()")) {
      detectedTraits.push("instance-storage");
    }
    if (sourceCode.includes("storage().persistent()")) {
      detectedTraits.push("persistent-storage");
    }
    if (sourceCode.includes("storage().temporary()")) {
      detectedTraits.push("temporary-storage");
    }
    if (sourceCode.includes("token::Client") || sourceCode.includes("TokenClient") || sourceCode.includes("token_contract")) {
      detectedTraits.push("token-interaction");
    }
    if (sourceCode.includes("panic!") || sourceCode.includes("assert!")) {
      detectedTraits.push("panic-handling");
    }
    if (sourceCode.includes("for ") || sourceCode.includes("while ") || sourceCode.includes(".iter()")) {
      detectedTraits.push("loop-constructs");
    }

    // 2. Map traits to recommendations
    if (detectedTraits.includes("authorization")) {
      recommendations.push({
        id: "check-auth-ordering",
        name: "Verify auth argument ordering",
        reason: "Contract uses require_auth(). Ensure arguments match defined ordering to avoid unauthorized bypass.",
        severity: "critical",
        category: "security",
      });
    }

    if (detectedTraits.includes("instance-storage") || detectedTraits.includes("persistent-storage")) {
      recommendations.push({
        id: "storage-caching",
        name: "Implement storage caching",
        reason: "Contract uses persistent or instance storage. Cache reads to local memory variables to avoid costly redundant reads.",
        severity: "high",
        category: "gas-optimization",
      });
    }

    if (detectedTraits.includes("token-interaction")) {
      recommendations.push({
        id: "token-compatibility",
        name: "Token compatibility validation",
        reason: "Contract interacts with external tokens. Verify return values, decimals, and transfer behaviors.",
        severity: "high",
        category: "security",
      });
    }

    if (detectedTraits.includes("loop-constructs") && (detectedTraits.includes("instance-storage") || detectedTraits.includes("persistent-storage"))) {
      recommendations.push({
        id: "loop-storage-avoidance",
        name: "Avoid storage reads in loops",
        reason: "Detected loops and storage usage. Reading/writing storage inside a loop significantly inflates CPU/fee costs.",
        severity: "critical",
        category: "gas-optimization",
      });
    }

    if (detectedTraits.includes("temporary-storage")) {
      recommendations.push({
        id: "temporary-storage-ttl",
        name: "Validate TTL configuration",
        reason: "Contract uses temporary storage. Ensure proper TTL extension policies are defined to prevent premature deletion.",
        severity: "medium",
        category: "best-practices",
      });
    }

    if (detectedTraits.includes("panic-handling")) {
      recommendations.push({
        id: "panic-revert-check",
        name: "Graceful error propagation",
        reason: "Direct panics or assertions found. Prefer returning custom Results or Errors for cleaner execution tracing.",
        severity: "low",
        category: "best-practices",
      });
    }

    // Base recommendation for all Soroban contracts
    recommendations.push({
      id: "soroban-sdk-updates",
      name: "Track Soroban SDK updates",
      reason: "Always verify compatibility with the latest Soroban SDK versions and protocol features.",
      severity: "info",
      category: "best-practices",
    });

    return {
      detectedTraits,
      recommendations,
    };
  }
}
