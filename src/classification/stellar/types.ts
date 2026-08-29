export type ContractCategory = "token" | "governance" | "utility" | "unknown";

export interface CategorizationResult {
  category: ContractCategory;
  confidence: number; // 0 to 100
  matchedIndicators: string[];
}
