export class SorobanAnalyzer {
  analyze(source: string) {
    const issues = [];

    if (source.includes("storage().instance().get")) {
      issues.push({
        ruleId: "SOROBAN_STORAGE_REDUNDANT_READ",
        severity: "medium",
        message: "Repeated storage reads detected",
        suggestion: "Cache storage value in a local variable",
      });
    }

    if (source.includes("for") && source.includes("storage().instance().get")) {
      issues.push({
        ruleId: "SOROBAN_LOOP_STORAGE_ACCESS",
        severity: "high",
        message: "Storage access inside loop detected",
        suggestion: "Batch reads or redesign storage layout",
      });
    }

    if (source.includes(".clone()")) {
      issues.push({
        ruleId: "SOROBAN_REDUNDANT_CLONE",
        severity: "low",
        message: "Unnecessary clone detected",
        suggestion: "Avoid cloning; return original or borrow",
      });
    }

    return { issues };
  }
}
