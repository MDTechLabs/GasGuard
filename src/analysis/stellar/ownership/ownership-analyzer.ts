/**
 * Soroban Contract Ownership Analyzer
 *
 * Analyzes ownership and administrative structures in Soroban contracts.
 * Detects ownership patterns (single-owner, multi-sig, role-based, time-locked),
 * identifies privileged operations, and maps administrative access control.
 */

export type OwnershipPattern =
  | "single-owner"
  | "multi-sig"
  | "role-based"
  | "time-locked"
  | "unknown";

export interface OwnershipAnalysis {
  contractName: string;
  detectedPattern: OwnershipPattern;
  ownerAddresses: string[];
  adminFunctions: AdminFunction[];
  roleAssignments: RoleAssignment[];
  timeLocks: TimeLockEntry[];
  ownerChecks: OwnerCheck[];
  riskLevel: "low" | "medium" | "high" | "critical";
  summary: string;
}

export interface AdminFunction {
  name: string;
  lineNumber: number;
  requiresAuth: boolean;
  description: string;
}

export interface RoleAssignment {
  role: string;
  functionName: string;
  lineNumber: number;
  target: string;
}

export interface TimeLockEntry {
  functionName: string;
  delay: string;
  lineNumber: number;
}

export interface OwnerCheck {
  functionName: string;
  lineNumber: number;
  checkExpression: string;
}

export class StellarOwnershipAnalyzer {
  private source: string;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
  }

  analyze(): OwnershipAnalysis {
    const contractName = this.extractContractName();
    const adminFunctions = this.findAdminFunctions();
    const roleAssignments = this.findRoleAssignments();
    const timeLocks = this.findTimeLocks();
    const ownerChecks = this.findOwnerChecks();
    const detectedPattern = this.detectOwnershipPattern(
      adminFunctions,
      roleAssignments,
      timeLocks,
    );
    const ownerAddresses = this.extractOwnerAddresses();
    const riskLevel = this.calculateRiskLevel(
      detectedPattern,
      adminFunctions,
      timeLocks,
    );
    const summary = this.buildSummary(
      contractName,
      detectedPattern,
      adminFunctions,
      roleAssignments,
    );

    return {
      contractName,
      detectedPattern,
      ownerAddresses,
      adminFunctions,
      roleAssignments,
      timeLocks,
      ownerChecks,
      riskLevel,
      summary,
    };
  }

  private extractContractName(): string {
    const typeMatch = this.source.match(/pub struct (\w+)/);
    return typeMatch ? typeMatch[1] : "UnknownContract";
  }

  private findAdminFunctions(): AdminFunction[] {
    const functions: AdminFunction[] = [];
    const funcRegex = /(pub\s+)?fn\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = funcRegex.exec(this.source)) !== null) {
      const name = match[2];
      const nameLower = name.toLowerCase();
      const isAdmin =
        nameLower.includes("admin") ||
        nameLower.includes("owner") ||
        nameLower.includes("set_owner") ||
        nameLower.includes("transfer_ownership") ||
        nameLower.includes("pause") ||
        nameLower.includes("emergency") ||
        nameLower.includes("upgrade") ||
        nameLower.includes("withdraw") ||
        nameLower.includes("mint") ||
        nameLower.includes("burn") ||
        nameLower.includes("set_fee") ||
        nameLower.includes("set_config") ||
        nameLower.includes("add_role") ||
        nameLower.includes("remove_role") ||
        nameLower.includes("grant_role") ||
        nameLower.includes("revoke_role");

      if (isAdmin) {
        const body = this.extractFunctionBody(name);
        const lineNumber = this.getLineNumber(match.index);
        functions.push({
          name,
          lineNumber,
          requiresAuth:
            body.includes("require_auth") ||
            body.includes("owner") ||
            body.includes("admin"),
          description: this.describeAdminFunction(name),
        });
      }
    }

    return functions;
  }

  private findRoleAssignments(): RoleAssignment[] {
    const assignments: RoleAssignment[] = [];
    const rolePatterns = [
      /(add_role|grant_role|set_role|remove_role|revoke_role)\s*\(/g,
      /roles\.\s*(insert|set|add)\s*\(/g,
    ];

    for (const pattern of rolePatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(this.source)) !== null) {
        const functionName = this.findEnclosingFunction(match.index);
        const lineNumber = this.getLineNumber(match.index);
        assignments.push({
          role: match[1],
          functionName,
          lineNumber,
          target: functionName,
        });
      }
    }

    return assignments;
  }

  private findTimeLocks(): TimeLockEntry[] {
    const locks: TimeLockEntry[] = [];
    const timeLockPatterns = [
      /timelock|time_lock|time-lock|delay/i,
      /ledger\.timestamp.*\+/,
      /deadline.*timestamp/,
    ];

    const funcRegex = /fn\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = funcRegex.exec(this.source)) !== null) {
      const name = match[1];
      const body = this.extractFunctionBody(name);

      for (const pattern of timeLockPatterns) {
        if (pattern.test(body)) {
          const lineNumber = this.getLineNumber(match.index);
          locks.push({
            functionName: name,
            delay: this.extractDelayValue(body),
            lineNumber,
          });
          break;
        }
      }
    }

    return locks;
  }

  private findOwnerChecks(): OwnerCheck[] {
    const checks: OwnerCheck[] = [];
    const checkPatterns = [
      /if\s+(\w+)\s*(!=|!==)\s*(self\.owner|self\.admin|owner|admin)/g,
      /require\!\s*\(\s*(\w+)\s*(==|===)\s*(self\.owner|self\.admin)/g,
      /(\w+)\s*\.\s*require_auth\s*\(/g,
    ];

    for (const pattern of checkPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(this.source)) !== null) {
        const functionName = this.findEnclosingFunction(match.index);
        const lineNumber = this.getLineNumber(match.index);
        checks.push({
          functionName,
          lineNumber,
          checkExpression: match[0],
        });
      }
    }

    return checks;
  }

  private detectOwnershipPattern(
    adminFunctions: AdminFunction[],
    roleAssignments: RoleAssignment[],
    timeLocks: TimeLockEntry[],
  ): OwnershipPattern {
    const adminCount = adminFunctions.length;
    const roleCount = roleAssignments.length;
    const timeLockCount = timeLocks.length;

    if (roleCount > 0) {
      return "role-based";
    }

    const hasRoleStruct =
      /pub\s+struct\s+\w+\s*\{[^}]*\b(admin|minter|pauser|role|roles)\b[^}]*\}/i.test(
        this.source,
      );
    if (hasRoleStruct) {
      return "role-based";
    }

    if (timeLockCount > 0) {
      return "time-locked";
    }

    if (adminCount > 3) {
      return "multi-sig";
    }

    if (adminCount > 0) {
      return "single-owner";
    }

    return "unknown";
  }

  private extractOwnerAddresses(): string[] {
    const addresses: string[] = [];
    const addrPatterns = [
      /owner\s*:\s*(Address|Identifier)/g,
      /admin\s*:\s*(Address|Identifier)/g,
      /multi_sig\s*:\s*(Address|Identifier)/g,
    ];

    for (const pattern of addrPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(this.source)) !== null) {
        addresses.push(match[1]);
      }
    }

    return addresses;
  }

  private calculateRiskLevel(
    pattern: OwnershipPattern,
    adminFunctions: AdminFunction[],
    timeLocks: TimeLockEntry[],
  ): "low" | "medium" | "high" | "critical" {
    if (adminFunctions.length === 0) {
      return "critical";
    }

    if (pattern === "unknown") {
      return "high";
    }

    const unauthenticated = adminFunctions.filter((f) => !f.requiresAuth);
    if (unauthenticated.length > 0) {
      return "critical";
    }

    if (pattern === "single-owner" && timeLocks.length === 0) {
      return "high";
    }

    if (pattern === "role-based" || pattern === "multi-sig") {
      return "medium";
    }

    if (pattern === "time-locked") {
      return "low";
    }

    return "medium";
  }

  private buildSummary(
    contractName: string,
    pattern: OwnershipPattern,
    adminFunctions: AdminFunction[],
    roleAssignments: RoleAssignment[],
  ): string {
    const parts: string[] = [];
    parts.push(`Contract "${contractName}" uses ${pattern} ownership pattern`);

    if (adminFunctions.length > 0) {
      parts.push(
        `with ${adminFunctions.length} admin function(s) (${adminFunctions.filter((f) => f.requiresAuth).length} authenticated)`,
      );
    }

    if (roleAssignments.length > 0) {
      const uniqueRoles = [...new Set(roleAssignments.map((r) => r.role))];
      parts.push(`and ${uniqueRoles.length} role(s) defined`);
    }

    return parts.join(" ");
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

  private findEnclosingFunction(offset: number): string {
    const funcRegex = /(pub\s+)?fn\s+(\w+)\s*\(/g;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;

    while ((match = funcRegex.exec(this.source)) !== null) {
      if (match.index <= offset) {
        lastMatch = match;
      } else {
        break;
      }
    }

    return lastMatch ? lastMatch[2] : "unknown";
  }

  private getLineNumber(offset: number): number {
    const before = this.source.substring(0, offset);
    return (before.match(/\n/g) || []).length + 1;
  }

  private extractDelayValue(body: string): string {
    const delayMatch =
      body.match(/(\d+)\s*seconds?/) ||
      body.match(/(\d+)\s*minutes?/) ||
      body.match(/(\d+)\s*hours?/) ||
      body.match(/(\d+)\s*days?/);
    return delayMatch ? delayMatch[0] : "unknown";
  }

  private describeAdminFunction(name: string): string {
    const nameLower = name.toLowerCase();
    if (nameLower.includes("set_owner") || nameLower.includes("transfer_ownership"))
      return "Transfers contract ownership to a new address";
    if (nameLower.includes("pause")) return "Pauses/unpauses contract operations";
    if (nameLower.includes("emergency")) return "Triggers emergency shutdown procedures";
    if (nameLower.includes("upgrade")) return "Upgrades contract implementation";
    if (nameLower.includes("withdraw")) return "Withdraws funds from the contract";
    if (nameLower.includes("mint")) return "Mints new tokens";
    if (nameLower.includes("burn")) return "Burns tokens";
    if (nameLower.includes("set_fee")) return "Updates fee configuration";
    if (nameLower.includes("set_config")) return "Updates contract configuration";
    if (nameLower.includes("add_role") || nameLower.includes("grant_role"))
      return "Assigns a role to an address";
    if (nameLower.includes("remove_role") || nameLower.includes("revoke_role"))
      return "Removes a role from an address";
    if (nameLower.includes("admin")) return "Administrative operation";
    if (nameLower.includes("owner")) return "Owner-only operation";
    return "Administrative operation";
  }
}
