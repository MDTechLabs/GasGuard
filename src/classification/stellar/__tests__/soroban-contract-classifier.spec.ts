import { SorobanContractClassifier } from "../soroban-contract-classifier";
import { SorobanArchitectureSummary } from "../../../reporting/stellar/architecture/types";

describe("SorobanContractClassifier", () => {
  let classifier: SorobanContractClassifier;

  beforeEach(() => {
    classifier = new SorobanContractClassifier();
  });

  function createMockSummary(contractType: "single" | "library", functionNames: string[]): SorobanArchitectureSummary {
    return {
      contractInfo: {
        name: "TestContract",
        filePath: "test.rs",
        contractType,
        linesOfCode: 100,
        complexity: "low",
        hasTests: false,
        hasDocumentation: false,
      },
      moduleStructure: { contractTypes: [], enums: [], traits: [], totalTypes: 0, stateComplexity: "minimal" },
      functionInventory: {
        publicFunctions: functionNames.map(name => ({
          name, visibility: "public", parameters: [], returnType: "void", complexity: 1, 
          hasErrorHandling: false, hasAuthChecks: false, hasExpiryChecks: false, category: "unknown", securityLevel: "low"
        })),
        privateFunctions: [],
        totalFunctions: functionNames.length,
        averageComplexity: 1,
        categorization: { constructors: 0, transfers: 0, queries: 0, admin: 0, governance: 0, emergency: 0, healthChecks: 0, utilities: 0 }
      },
      storagePatterns: { storageOperations: { totalReads: 0, totalWrites: 0, uniqueKeys: 0, averageAccessesPerFunction: 0, hasRedundantReads: false, hasLoopStorage: false }, patterns: [], optimizationOpportunities: [] },
      securityBoundaries: { hasAccessControl: false, adminFunctions: [], publicFunctions: functionNames, hasPauseCircuit: false, hasEmergencyMechanism: false, hasRateLimiting: false, authenticationPatterns: [], vulnerabilities: [] },
      resourceProfile: { cpuProfile: { estimatedInstructions: 0, utilizationPercentage: 0, complexFunctions: [], optimizationPotential: "low" }, memoryProfile: { estimatedPeakMemory: 0, utilizationPercentage: 0, largeAllocations: [], optimizationPotential: "low" }, ledgerProfile: { averageReads: 0, averageWrites: 0, storageFootprint: 0, bandwidth: 0, optimizationPotential: "low" }, overallEfficiency: "good", bottlenecks: [] },
      dependencies: { externalContracts: [], internalDependencies: [], circularDependencies: [], complexityScore: 0 },
      generatedAt: new Date(),
      version: "1.0",
    };
  }

  it("should classify a token contract correctly", () => {
    const summary = createMockSummary("single", ["transfer", "transfer_from", "balance", "allowance", "mint"]);
    const result = classifier.classify(summary);
    
    expect(result.category).toBe("token");
    expect(result.confidence).toBeGreaterThan(80);
    expect(result.matchedIndicators.length).toBe(5);
  });

  it("should classify a governance contract correctly", () => {
    const summary = createMockSummary("single", ["propose", "vote", "execute", "tally"]);
    const result = classifier.classify(summary);
    
    expect(result.category).toBe("governance");
    expect(result.confidence).toBeGreaterThan(80);
    expect(result.matchedIndicators.length).toBe(4);
  });

  it("should classify a utility contract (library) correctly", () => {
    const summary = createMockSummary("library", ["math_add", "math_sub"]);
    const result = classifier.classify(summary);
    
    expect(result.category).toBe("utility");
    expect(result.confidence).toBe(80);
    expect(result.matchedIndicators).toContain("contractType:library");
  });

  it("should return unknown if no indicators match", () => {
    const summary = createMockSummary("single", ["do_something", "hello_world"]);
    const result = classifier.classify(summary);
    
    expect(result.category).toBe("unknown");
    expect(result.confidence).toBe(0);
  });
});
