/**
 * Soroban Contract Architecture Analyzer
 *
 * Analyzes Soroban contract source code to extract architectural information
 * including modules, functions, storage patterns, and security boundaries.
 */

import {
  SorobanArchitectureSummary,
  ContractInfo,
  ModuleStructure,
  FunctionInventory,
  StoragePatterns,
  SecurityBoundaries,
  ResourceProfile,
  DependencyGraph,
  FunctionInfo,
  FunctionCategory,
  ContractTypeInfo,
  FieldInfo,
  DetectedPattern,
  OptimizationOpportunity,
  AuthPattern,
  VulnerabilityIndicator,
  Bottleneck,
} from "./types";
import {
  Finding,
  Severity,
} from "../../../../libs/engine/core/analyzer-interface";
import { RiskScore } from "../../../scoring/stellar/risk-scoring-engine";
import { ExecutionMetrics } from "../../../simulation/stellar/types";

/**
 * Architecture analyzer for Soroban smart contracts
 */
export class SorobanArchitectureAnalyzer {
  private source: string;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
  }

  /**
   * Generate complete architecture summary
   */
  analyze(
    findings?: Finding[],
    riskScore?: RiskScore,
    metrics?: ExecutionMetrics,
  ): SorobanArchitectureSummary {
    return {
      contractInfo: this.analyzeContractInfo(),
      moduleStructure: this.analyzeModuleStructure(),
      functionInventory: this.analyzeFunctionInventory(),
      storagePatterns: this.analyzeStoragePatterns(),
      securityBoundaries: this.analyzeSecurityBoundaries(),
      resourceProfile: this.analyzeResourceProfile(metrics),
      dependencies: this.analyzeDependencies(),
      riskAssessment: riskScore,
      findings: findings,
      generatedAt: new Date(),
      version: "1.0.0",
    };
  }

  /**
   * Analyze basic contract information
   */
  private analyzeContractInfo(): ContractInfo {
    const lines = this.source.split("\n");
    const linesOfCode = lines.filter(
      (line) => line.trim() && !line.trim().startsWith("//"),
    ).length;

    const hasMultipleImpls =
      (this.source.match(/#\[contractimpl\]/g) || []).length > 1;
    const hasTests =
      this.source.includes("#[test]") || this.source.includes("mod test");
    const hasDocumentation =
      this.source.includes("//!") || this.source.includes("///");

    const functionCount = this.countFunctions();
    const complexity = this.determineComplexity(linesOfCode, functionCount);

    const contractName = this.extractContractName();

    return {
      name: contractName,
      filePath: this.filePath,
      contractType: hasMultipleImpls ? "multi-module" : "single",
      linesOfCode,
      complexity,
      hasTests,
      hasDocumentation,
    };
  }

  /**
   * Analyze module and type structure
   */
  private analyzeModuleStructure(): ModuleStructure {
    const contractTypes = this.extractContractTypes();
    const enums = this.extractEnums();
    const traits = this.extractTraits();

    const totalTypes = contractTypes.length + enums.length + traits.length;
    const stateComplexity = this.determineStateComplexity(contractTypes);

    return {
      contractTypes,
      enums,
      traits,
      totalTypes,
      stateComplexity,
    };
  }

  /**
   * Analyze function inventory
   */
  private analyzeFunctionInventory(): FunctionInventory {
    const functions = this.extractFunctions();
    const publicFunctions = functions.filter((f) => f.visibility === "public");
    const privateFunctions = functions.filter(
      (f) => f.visibility === "private",
    );

    const averageComplexity =
      functions.reduce((sum, f) => sum + f.complexity, 0) / functions.length ||
      0;

    const categorization = this.categorizeFunctions(functions);

    return {
      publicFunctions,
      privateFunctions,
      totalFunctions: functions.length,
      averageComplexity,
      categorization,
    };
  }

  /**
   * Analyze storage patterns
   */
  private analyzeStoragePatterns(): StoragePatterns {
    const storageReads = this.countStorageOperations("get");
    const storageWrites = this.countStorageOperations("set");
    const hasRedundantReads = this.detectRedundantReads();
    const hasLoopStorage = this.detectLoopStorage();

    const patterns = this.detectStoragePatterns();
    const optimizationOpportunities = this.identifyOptimizations();

    return {
      storageOperations: {
        totalReads: storageReads,
        totalWrites: storageWrites,
        uniqueKeys: this.estimateUniqueKeys(),
        averageAccessesPerFunction:
          (storageReads + storageWrites) / this.countFunctions(),
        hasRedundantReads,
        hasLoopStorage,
      },
      patterns,
      optimizationOpportunities,
    };
  }

  /**
   * Analyze security boundaries
   */
  private analyzeSecurityBoundaries(): SecurityBoundaries {
    const hasAccessControl =
      this.source.includes("owner") || this.source.includes("admin");
    const hasPauseCircuit =
      this.source.includes("paused") || this.source.includes("emergency");
    const hasEmergencyMechanism = this.source.includes("emergency");
    const hasRateLimiting =
      this.source.includes("rate_limit") || this.source.includes("cooldown");

    const authPatterns = this.detectAuthPatterns();
    const vulnerabilities = this.detectVulnerabilities();

    const functions = this.extractFunctions();
    const adminFunctions = functions
      .filter((f) => f.category === "admin" || f.category === "emergency")
      .map((f) => f.name);
    const publicFunctions = functions
      .filter((f) => f.visibility === "public")
      .map((f) => f.name);

    return {
      hasAccessControl,
      accessControlMechanism: this.detectAccessControlMechanism(),
      adminFunctions,
      publicFunctions,
      hasPauseCircuit,
      hasEmergencyMechanism,
      hasRateLimiting,
      authenticationPatterns: authPatterns,
      vulnerabilities,
    };
  }

  /**
   * Analyze resource consumption profile
   */
  private analyzeResourceProfile(metrics?: ExecutionMetrics): ResourceProfile {
    const functions = this.extractFunctions();
    const complexFunctions = functions
      .filter((f) => f.complexity > 10)
      .map((f) => f.name);

    const cpuOpt: "low" | "medium" | "high" =
      complexFunctions.length > 3 ? "high" : "low";
    const cpuProfile = {
      estimatedInstructions:
        metrics?.instructions || this.estimateInstructions(),
      utilizationPercentage: metrics
        ? (metrics.instructions / 100_000_000) * 100
        : 0,
      complexFunctions,
      optimizationPotential: cpuOpt,
    };

    const memoryProfile = {
      estimatedPeakMemory: metrics?.memoryBytes || this.estimateMemory(),
      utilizationPercentage: metrics
        ? (metrics.memoryBytes / 41_943_040) * 100
        : 0,
      largeAllocations: this.detectLargeAllocations(),
      optimizationPotential:
        this.source.includes("Vec") || this.source.includes("String")
          ? ("medium" as const)
          : ("low" as const),
    };

    const ledgerOpt: "low" | "medium" | "high" = this.detectLoopStorage()
      ? "high"
      : "low";
    const ledgerProfile = {
      averageReads: this.countStorageOperations("get") / this.countFunctions(),
      averageWrites: this.countStorageOperations("set") / this.countFunctions(),
      storageFootprint: this.estimateStorageFootprint(),
      bandwidth: this.estimateBandwidth(),
      optimizationPotential: ledgerOpt,
    };

    const bottlenecks = this.identifyBottlenecks(
      cpuProfile,
      memoryProfile,
      ledgerProfile,
    );

    const overallEfficiency = this.determineOverallEfficiency(
      cpuProfile,
      memoryProfile,
      ledgerProfile,
    );

    return {
      cpuProfile,
      memoryProfile,
      ledgerProfile,
      overallEfficiency,
      bottlenecks,
    };
  }

  /**
   * Analyze dependencies
   */
  private analyzeDependencies(): DependencyGraph {
    const externalContracts = this.extractExternalContracts();
    const internalDependencies = this.extractInternalDependencies();
    const circularDependencies = this.detectCircularDependencies();

    const complexityScore =
      externalContracts.length * 2 + internalDependencies.length;

    return {
      externalContracts,
      internalDependencies,
      circularDependencies,
      complexityScore,
    };
  }

  // ===== Helper Methods =====

  private extractContractName(): string {
    const typeMatch = this.source.match(/pub struct (\w+)/);
    return typeMatch ? typeMatch[1] : "UnknownContract";
  }

  private countFunctions(): number {
    return (this.source.match(/pub fn |fn /g) || []).length;
  }

  private determineComplexity(
    loc: number,
    functionCount: number,
  ): "low" | "medium" | "high" | "critical" {
    if (loc > 500 || functionCount > 20) return "critical";
    if (loc > 300 || functionCount > 15) return "high";
    if (loc > 150 || functionCount > 10) return "medium";
    return "low";
  }

  private extractContractTypes(): ContractTypeInfo[] {
    const types: ContractTypeInfo[] = [];
    const typeRegex = /#\[contracttype\]\s*pub struct (\w+)\s*\{([^}]+)\}/g;
    let match;

    while ((match = typeRegex.exec(this.source)) !== null) {
      const name = match[1];
      const fieldsText = match[2];
      const fields = this.parseFields(fieldsText);

      types.push({
        name,
        fields,
        hasVersioning: fields.some((f) => f.name.includes("version")),
        hasPauseState: fields.some((f) => f.name.includes("pause")),
        hasAccessControl:
          fields.some((f) => f.name.includes("owner")) ||
          fields.some((f) => f.name.includes("admin")),
      });
    }

    return types;
  }

  private parseFields(fieldsText: string): FieldInfo[] {
    const fields: FieldInfo[] = [];
    const fieldLines = fieldsText.split("\n");

    for (const line of fieldLines) {
      const fieldMatch = line.match(/pub\s+(\w+)\s*:\s*([^,]+)/);
      if (fieldMatch) {
        fields.push({
          name: fieldMatch[1],
          fieldType: fieldMatch[2].trim(),
          isPublic: true,
        });
      }
    }

    return fields;
  }

  private extractEnums(): any[] {
    const enums: any[] = [];
    const enumRegex = /pub enum (\w+)/g;
    let match;

    while ((match = enumRegex.exec(this.source)) !== null) {
      enums.push({
        name: match[1],
        variants: [],
        usageCount: 0,
      });
    }

    return enums;
  }

  private extractTraits(): any[] {
    return []; // Simplified for now
  }

  private determineStateComplexity(
    types: ContractTypeInfo[],
  ): "minimal" | "moderate" | "complex" {
    const totalFields = types.reduce((sum, t) => sum + t.fields.length, 0);
    if (totalFields > 15) return "complex";
    if (totalFields > 8) return "moderate";
    return "minimal";
  }

  private extractFunctions(): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const funcRegex = /(pub )?fn\s+(\w+)\s*\([^)]*\)\s*(?:->\s*([^{]+))?/g;
    let match;

    while ((match = funcRegex.exec(this.source)) !== null) {
      const visibility = match[1] ? "public" : "private";
      const name = match[2];
      const returnType = match[3]?.trim() || "void";

      const funcBody = this.extractFunctionBody(name);
      const complexity = this.calculateComplexity(funcBody);
      const category = this.categorizeFunctionByName(name, funcBody);

      functions.push({
        name,
        visibility,
        parameters: [],
        returnType,
        complexity,
        hasErrorHandling: funcBody.includes("Result") || funcBody.includes("?"),
        hasAuthChecks:
          funcBody.includes("require_auth") ||
          funcBody.includes("owner") ||
          funcBody.includes("admin"),
        hasExpiryChecks:
          funcBody.includes("deadline") || funcBody.includes("timestamp"),
        category,
        securityLevel: this.determineSecurityLevel(category, funcBody),
      });
    }

    return functions;
  }

  private extractFunctionBody(funcName: string): string {
    const funcStart = this.source.indexOf(`fn ${funcName}`);
    if (funcStart === -1) return "";

    let braceCount = 0;
    let started = false;
    let body = "";

    for (let i = funcStart; i < this.source.length; i++) {
      const char = this.source[i];
      if (char === "{") {
        braceCount++;
        started = true;
      }
      if (started) body += char;
      if (char === "}") {
        braceCount--;
        if (braceCount === 0) break;
      }
    }

    return body;
  }

  private calculateComplexity(code: string): number {
    let complexity = 1;
    complexity += (code.match(/if /g) || []).length;
    complexity += (code.match(/for /g) || []).length;
    complexity += (code.match(/while /g) || []).length;
    complexity += (code.match(/match /g) || []).length * 2;
    return complexity;
  }

  private categorizeFunctionByName(
    name: string,
    body: string,
  ): FunctionCategory {
    const nameLower = name.toLowerCase();

    if (nameLower.includes("new") || nameLower.includes("init"))
      return "constructor";
    if (nameLower.includes("transfer") || nameLower.includes("send"))
      return "transfer";
    if (
      nameLower.includes("get") ||
      nameLower.includes("query") ||
      nameLower.includes("view")
    )
      return "query";
    if (
      nameLower.includes("admin") ||
      nameLower.includes("owner") ||
      nameLower.includes("set_owner")
    )
      return "admin";
    if (nameLower.includes("emergency") || nameLower.includes("pause"))
      return "emergency";
    if (nameLower.includes("health") || nameLower.includes("check"))
      return "health-check";
    if (nameLower.includes("vote") || nameLower.includes("propose"))
      return "governance";

    return "utility";
  }

  private categorizeFunctions(functions: FunctionInfo[]): any {
    return {
      constructors: functions.filter((f) => f.category === "constructor")
        .length,
      transfers: functions.filter((f) => f.category === "transfer").length,
      queries: functions.filter((f) => f.category === "query").length,
      admin: functions.filter((f) => f.category === "admin").length,
      governance: functions.filter((f) => f.category === "governance").length,
      emergency: functions.filter((f) => f.category === "emergency").length,
      healthChecks: functions.filter((f) => f.category === "health-check")
        .length,
      utilities: functions.filter((f) => f.category === "utility").length,
    };
  }

  private determineSecurityLevel(
    category: FunctionCategory,
    body: string,
  ): "critical" | "high" | "medium" | "low" {
    if (category === "admin" || category === "emergency") return "critical";
    if (category === "transfer" || category === "governance") return "high";
    if (category === "constructor") return "high";
    if (body.includes("storage") || body.includes("balance")) return "medium";
    return "low";
  }

  private countStorageOperations(operation: "get" | "set"): number {
    const pattern =
      operation === "get" ? /storage\(\).*\.get/g : /storage\(\).*\.set/g;
    return (this.source.match(pattern) || []).length;
  }

  private detectRedundantReads(): boolean {
    return (
      this.source.includes("storage") &&
      this.source.includes(".get") &&
      (this.source.match(/\.get\(/g) || []).length > 3
    );
  }

  private detectLoopStorage(): boolean {
    // Look for simple pattern: for/while loops containing .get( or .set(
    return (
      (this.source.includes("for") && this.source.includes(".get(")) ||
      (this.source.includes("while") && this.source.includes(".get(")) ||
      (this.source.includes("for") && this.source.includes(".set(")) ||
      (this.source.includes("while") && this.source.includes(".set("))
    );
  }

  private estimateUniqueKeys(): number {
    const keys = new Set<string>();
    const keyRegex = /storage\(\).*?\.(?:get|set)\(([^)]+)\)/g;
    let match;

    while ((match = keyRegex.exec(this.source)) !== null) {
      keys.add(match[1]);
    }

    return keys.size;
  }

  private detectStoragePatterns(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    if (this.detectRedundantReads()) {
      patterns.push({
        pattern: "redundant-read",
        description: "Multiple reads from same storage key without caching",
        locations: ["Multiple functions"],
        severity: "warning",
      });
    }

    if (this.detectLoopStorage()) {
      patterns.push({
        pattern: "loop-storage",
        description: "Storage access inside loops detected",
        locations: ["Loop sections"],
        severity: "critical",
      });
    }

    if (patterns.length === 0) {
      patterns.push({
        pattern: "efficient",
        description: "Storage access patterns appear well optimized",
        locations: [],
        severity: "info",
      });
    }

    return patterns;
  }

  private identifyOptimizations(): OptimizationOpportunity[] {
    const opportunities: OptimizationOpportunity[] = [];

    if (this.detectRedundantReads()) {
      opportunities.push({
        type: "storage",
        title: "Cache storage reads",
        description: "Store frequently accessed values in local variables",
        estimatedSavings: "20-40% gas reduction",
        priority: "high",
        affectedFunctions: this.extractFunctions().map((f) => f.name),
      });
    }

    if (this.source.includes("String")) {
      opportunities.push({
        type: "memory",
        title: "Replace String with Symbol",
        description: "Use Symbol type for fixed strings to reduce memory",
        estimatedSavings: "10-15% memory reduction",
        priority: "medium",
        affectedFunctions: [],
      });
    }

    if (opportunities.length === 0) {
      opportunities.push({
        type: "gas",
        title: "Contract structure looks well optimized",
        description: "No obvious optimization opportunities detected",
        estimatedSavings: "5-10% potential gas savings",
        priority: "low",
        affectedFunctions: [],
      });
    }

    return opportunities;
  }

  private detectAuthPatterns(): AuthPattern[] {
    const patterns: AuthPattern[] = [];

    const requireAuthCount = (this.source.match(/require_auth/g) || []).length;
    if (requireAuthCount > 0) {
      patterns.push({
        pattern: "require_auth",
        usageCount: requireAuthCount,
        functions: [],
      });
    }

    return patterns;
  }

  private detectVulnerabilities(): VulnerabilityIndicator[] {
    const vulnerabilities: VulnerabilityIndicator[] = [];

    // Check for missing expiry
    if (this.source.includes("claim") && !this.source.includes("deadline")) {
      vulnerabilities.push({
        type: "missing-expiry",
        severity: "medium",
        description: "Functions accepting claims without expiration checks",
        affectedFunctions: ["claim_airdrop"],
        recommendation:
          "Add deadline parameter and validate against ledger timestamp",
      });
    }

    // Check for weak randomness
    if (
      this.source.includes("random") &&
      !this.source.includes("prng_bytes_new")
    ) {
      vulnerabilities.push({
        type: "weak-randomness",
        severity: "high",
        description: "Using predictable randomness sources",
        affectedFunctions: ["generate_random_id"],
        recommendation: "Use env.prng() for secure randomness",
      });
    }

    // Check for front-running vulnerabilities
    if (this.source.includes("swap") && !this.source.includes("min_amount")) {
      vulnerabilities.push({
        type: "front-running",
        severity: "high",
        description: "Swap functions without slippage protection",
        affectedFunctions: ["swap_tokens"],
        recommendation: "Add min_amount parameter and deadline checks",
      });
    }

    return vulnerabilities;
  }

  private detectAccessControlMechanism():
    | "owner"
    | "role-based"
    | "multi-sig"
    | "custom"
    | undefined {
    if (this.source.includes("owner")) return "owner";
    if (this.source.includes("role")) return "role-based";
    if (this.source.includes("multisig")) return "multi-sig";
    if (this.source.includes("require_auth")) return "custom";
    return undefined;
  }

  private estimateInstructions(): number {
    const functionCount = this.countFunctions();
    const avgInstructionsPerFunction = 50000;
    return functionCount * avgInstructionsPerFunction;
  }

  private estimateMemory(): number {
    const storageOps =
      this.countStorageOperations("get") + this.countStorageOperations("set");
    const avgMemoryPerOp = 10000;
    return Math.min(storageOps * avgMemoryPerOp, 41_943_040);
  }

  private detectLargeAllocations(): string[] {
    const allocations: string[] = [];
    if (this.source.includes("Vec::new")) allocations.push("Vec allocations");
    if (this.source.includes("String::from"))
      allocations.push("String allocations");
    return allocations;
  }

  private estimateStorageFootprint(): number {
    return this.estimateUniqueKeys() * 256; // Average bytes per entry
  }

  private estimateBandwidth(): number {
    return this.source.length; // Rough approximation
  }

  private identifyBottlenecks(
    cpu: any,
    memory: any,
    ledger: any,
  ): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    if (cpu.utilizationPercentage > 50) {
      bottlenecks.push({
        area: "cpu",
        description: "High CPU instruction usage detected",
        impact: "high",
        recommendation: "Optimize complex loops and reduce host function calls",
      });
    }

    if (ledger.averageReads > 3) {
      bottlenecks.push({
        area: "storage",
        description: "High number of storage reads per function",
        impact: "medium",
        recommendation: "Cache storage values in local variables",
      });
    }

    return bottlenecks;
  }

  private determineOverallEfficiency(
    cpu: any,
    memory: any,
    ledger: any,
  ): "excellent" | "good" | "moderate" | "poor" {
    const cpuEff =
      cpu.optimizationPotential === "low"
        ? 3
        : cpu.optimizationPotential === "medium"
          ? 2
          : 1;
    const memEff =
      memory.optimizationPotential === "low"
        ? 3
        : memory.optimizationPotential === "medium"
          ? 2
          : 1;
    const ledgerEff =
      ledger.optimizationPotential === "low"
        ? 3
        : ledger.optimizationPotential === "medium"
          ? 2
          : 1;

    const avgScore = (cpuEff + memEff + ledgerEff) / 3;

    if (avgScore >= 2.5) return "excellent";
    if (avgScore >= 2) return "good";
    if (avgScore >= 1.5) return "moderate";
    return "poor";
  }

  private extractExternalContracts(): any[] {
    return []; // Simplified
  }

  private extractInternalDependencies(): any[] {
    return []; // Simplified
  }

  private detectCircularDependencies(): string[] {
    return []; // Simplified
  }
}
