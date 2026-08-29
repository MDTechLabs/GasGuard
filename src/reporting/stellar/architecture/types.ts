/**
 * Stellar/Soroban Contract Architecture Summary Types
 *
 * Type definitions for generating architectural summaries of Soroban contracts
 * to help auditors quickly understand contract structure and design patterns.
 */

import {
  Finding,
  Severity,
} from "../../../../libs/engine/core/analyzer-interface";
import { RiskScore } from "../../../scoring/stellar/risk-scoring-engine";
import { ExecutionMetrics } from "../../../simulation/stellar/types";

/**
 * Complete architecture summary for a Soroban contract
 */
export interface SorobanArchitectureSummary {
  contractInfo: ContractInfo;
  moduleStructure: ModuleStructure;
  functionInventory: FunctionInventory;
  storagePatterns: StoragePatterns;
  securityBoundaries: SecurityBoundaries;
  resourceProfile: ResourceProfile;
  dependencies: DependencyGraph;
  riskAssessment?: RiskScore;
  findings?: Finding[];
  generatedAt: Date;
  version: string;
}

/**
 * Basic contract information
 */
export interface ContractInfo {
  name: string;
  filePath: string;
  contractType: "single" | "multi-module" | "library";
  linesOfCode: number;
  complexity: "low" | "medium" | "high" | "critical";
  hasTests: boolean;
  hasDocumentation: boolean;
}

/**
 * Module and type structure
 */
export interface ModuleStructure {
  contractTypes: ContractTypeInfo[];
  enums: EnumInfo[];
  traits: TraitInfo[];
  totalTypes: number;
  stateComplexity: "minimal" | "moderate" | "complex";
}

export interface ContractTypeInfo {
  name: string;
  fields: FieldInfo[];
  hasVersioning: boolean;
  hasPauseState: boolean;
  hasAccessControl: boolean;
}

export interface FieldInfo {
  name: string;
  fieldType: string;
  isPublic: boolean;
  isUnused?: boolean;
  isOptimizable?: boolean;
  purpose?: string;
}

export interface EnumInfo {
  name: string;
  variants: string[];
  usageCount: number;
}

export interface TraitInfo {
  name: string;
  methods: string[];
  isImplemented: boolean;
}

/**
 * Function inventory and categorization
 */
export interface FunctionInventory {
  publicFunctions: FunctionInfo[];
  privateFunctions: FunctionInfo[];
  totalFunctions: number;
  averageComplexity: number;
  categorization: FunctionCategorization;
}

export interface FunctionInfo {
  name: string;
  visibility: "public" | "private";
  parameters: ParameterInfo[];
  returnType: string;
  complexity: number;
  cyclomaticComplexity?: number;
  hasErrorHandling: boolean;
  hasAuthChecks: boolean;
  hasExpiryChecks: boolean;
  category: FunctionCategory;
  securityLevel: "critical" | "high" | "medium" | "low";
  estimatedGas?: number;
}

export interface ParameterInfo {
  name: string;
  paramType: string;
  isRequired: boolean;
}

export type FunctionCategory =
  | "constructor"
  | "transfer"
  | "query"
  | "admin"
  | "governance"
  | "emergency"
  | "health-check"
  | "utility"
  | "unknown";

export interface FunctionCategorization {
  constructors: number;
  transfers: number;
  queries: number;
  admin: number;
  governance: number;
  emergency: number;
  healthChecks: number;
  utilities: number;
}

/**
 * Storage access patterns and optimization opportunities
 */
export interface StoragePatterns {
  storageOperations: StorageOperationSummary;
  patterns: DetectedPattern[];
  optimizationOpportunities: OptimizationOpportunity[];
}

export interface StorageOperationSummary {
  totalReads: number;
  totalWrites: number;
  uniqueKeys: number;
  averageAccessesPerFunction: number;
  hasRedundantReads: boolean;
  hasLoopStorage: boolean;
}

export interface DetectedPattern {
  pattern:
    | "cache-candidate"
    | "batch-candidate"
    | "redundant-read"
    | "loop-storage"
    | "efficient";
  description: string;
  locations: string[];
  severity: "info" | "warning" | "critical";
}

export interface OptimizationOpportunity {
  type: "storage" | "computation" | "memory" | "gas";
  title: string;
  description: string;
  estimatedSavings: string;
  priority: "low" | "medium" | "high" | "critical";
  affectedFunctions: string[];
}

/**
 * Security boundaries and access control
 */
export interface SecurityBoundaries {
  hasAccessControl: boolean;
  accessControlMechanism?: "owner" | "role-based" | "multi-sig" | "custom";
  adminFunctions: string[];
  publicFunctions: string[];
  hasPauseCircuit: boolean;
  hasEmergencyMechanism: boolean;
  hasRateLimiting: boolean;
  authenticationPatterns: AuthPattern[];
  vulnerabilities: VulnerabilityIndicator[];
}

export interface AuthPattern {
  pattern: "require_auth" | "owner_check" | "role_check" | "custom";
  usageCount: number;
  functions: string[];
}

export interface VulnerabilityIndicator {
  type:
    | "missing-expiry"
    | "front-running"
    | "weak-randomness"
    | "unchecked-math"
    | "reentrancy";
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  affectedFunctions: string[];
  recommendation: string;
}

/**
 * Resource consumption profile
 */
export interface ResourceProfile {
  cpuProfile: CPUProfile;
  memoryProfile: MemoryProfile;
  ledgerProfile: LedgerProfile;
  overallEfficiency: "excellent" | "good" | "moderate" | "poor";
  bottlenecks: Bottleneck[];
}

export interface CPUProfile {
  estimatedInstructions: number;
  utilizationPercentage: number;
  complexFunctions: string[];
  optimizationPotential: "low" | "medium" | "high";
}

export interface MemoryProfile {
  estimatedPeakMemory: number;
  utilizationPercentage: number;
  largeAllocations: string[];
  optimizationPotential: "low" | "medium" | "high";
}

export interface LedgerProfile {
  averageReads: number;
  averageWrites: number;
  storageFootprint: number;
  bandwidth: number;
  optimizationPotential: "low" | "medium" | "high";
}

export interface Bottleneck {
  area: "cpu" | "memory" | "storage" | "bandwidth";
  description: string;
  impact: "low" | "medium" | "high" | "critical";
  recommendation: string;
}

/**
 * Dependency graph and external calls
 */
export interface DependencyGraph {
  externalContracts: ExternalContractRef[];
  internalDependencies: InternalDependency[];
  circularDependencies: string[];
  complexityScore: number;
}

export interface ExternalContractRef {
  name: string;
  purpose: string;
  callCount: number;
  functions: string[];
}

export interface InternalDependency {
  from: string;
  to: string;
  dependencyType: "function-call" | "data-access" | "type-reference";
}

/**
 * Architecture report export options
 */
export interface ArchitectureReportOptions {
  includeRiskScore?: boolean;
  includeFindings?: boolean;
  includeMetrics?: boolean;
  format?: "json" | "markdown" | "html";
  outputPath?: string;
  projectName?: string;
  contractVersion?: string;
}

/**
 * Best practice compliance tracking
 */
export interface BestPracticeCompliance {
  score: number; // 0-100
  compliantPractices: string[];
  violations: string[];
  recommendations: string[];
}
