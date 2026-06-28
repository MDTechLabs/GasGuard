import { SorobanArchitectureSummary } from "../../reporting/stellar/architecture/types";
import { CategorizationResult } from "./types";

const TOKEN_INDICATORS = [
  "transfer",
  "transfer_from",
  "mint",
  "burn",
  "balance",
  "allowance",
  "approve",
  "decimals",
  "name",
  "symbol",
];

const GOVERNANCE_INDICATORS = [
  "propose",
  "vote",
  "execute",
  "tally",
  "quorum",
  "delegate",
  "get_proposal",
  "cancel_proposal",
];

export class SorobanContractClassifier {
  public classify(summary: SorobanArchitectureSummary): CategorizationResult {
    const publicFunctions = summary.functionInventory.publicFunctions.map(f => f.name.toLowerCase());
    
    // Check for utility/library first
    if (summary.contractInfo.contractType === "library" || 
        (publicFunctions.length > 0 && publicFunctions.every(f => this.isUtilityFunction(f)))) {
      return {
        category: "utility",
        confidence: 80,
        matchedIndicators: ["contractType:library", ...publicFunctions],
      };
    }

    // Token scoring
    let tokenMatches = 0;
    const matchedTokenIndicators: string[] = [];
    for (const func of publicFunctions) {
      if (TOKEN_INDICATORS.some(ind => func.includes(ind))) {
        tokenMatches++;
        matchedTokenIndicators.push(func);
      }
    }

    // Governance scoring
    let govMatches = 0;
    const matchedGovIndicators: string[] = [];
    for (const func of publicFunctions) {
      if (GOVERNANCE_INDICATORS.some(ind => func.includes(ind))) {
        govMatches++;
        matchedGovIndicators.push(func);
      }
    }

    const tokenConfidence = Math.min((tokenMatches / Math.max(3, TOKEN_INDICATORS.length / 2)) * 100, 100);
    const govConfidence = Math.min((govMatches / Math.max(2, GOVERNANCE_INDICATORS.length / 2)) * 100, 100);

    if (tokenConfidence > 40 && tokenConfidence >= govConfidence) {
      return {
        category: "token",
        confidence: Math.round(tokenConfidence),
        matchedIndicators: matchedTokenIndicators,
      };
    }

    if (govConfidence > 40) {
      return {
        category: "governance",
        confidence: Math.round(govConfidence),
        matchedIndicators: matchedGovIndicators,
      };
    }

    // Fallback to unknown if confidence is too low
    return {
      category: "unknown",
      confidence: 0,
      matchedIndicators: [],
    };
  }

  private isUtilityFunction(funcName: string): boolean {
    const utils = ["math", "calc", "add", "sub", "mul", "div", "hash", "string", "concat"];
    return utils.some(u => funcName.includes(u));
  }
}
