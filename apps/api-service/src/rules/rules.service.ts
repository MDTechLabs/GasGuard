import { Injectable } from "@nestjs/common";
import { RuleDefinition } from "./interfaces/rules.interface";
import { RuleViolation } from "../scanner/interfaces/scanner.interface";

@Injectable()
export class RulesService {
  private readonly rules: RuleDefinition[] = [
    {
      name: "repeated-external-calls",
      description:
        "Detects repeated external contract calls and suggests caching call results.",
      severity: "warning",
      category: "security",
      enabled: true,
    },
    {
      name: "unsafe-delegatecall",
      description:
        "Detects risky delegatecall usage that may execute untrusted logic.",
      severity: "error",
      category: "security",
      enabled: true,
    },
    {
      name: "large-storage-arrays",
      description:
        "Detects large or unbounded storage arrays that can increase gas usage.",
      severity: "warning",
      category: "storage-optimization",
      enabled: true,
    },
    {
      name: "missing-access-modifiers",
      description:
        "Detects sensitive public/external functions missing access control checks.",
      severity: "warning",
      category: "security",
      enabled: true,
    },
    {
      name: "unused-state-variables",
      description:
        "Identifies state variables in Soroban contracts that are never read or written to, helping developers minimize storage footprint and ledger rent.",
      severity: "warning",
      category: "storage-optimization",
      enabled: true,
      documentationUrl: "https://gasguard.dev/rules/unused-state-variables",
    },
  ];

  getAllRules(): RuleDefinition[] {
    return this.rules;
  }

  getRule(name: string): RuleDefinition | undefined {
    return this.rules.find((rule) => rule.name === name);
  }

  getEnabledRules(): RuleDefinition[] {
    return this.rules.filter((rule) => rule.enabled);
  }

  async analyze(code: string): Promise<RuleViolation[]> {
    const violations: RuleViolation[] = [];
    const enabledRules = this.getEnabledRules();

    for (const rule of enabledRules) {
      const ruleViolations = await this.runRule(rule, code);
      violations.push(...ruleViolations);
    }

    return violations;
  }

  private async runRule(
    rule: RuleDefinition,
    code: string,
  ): Promise<RuleViolation[]> {
    switch (rule.name) {
      case "unused-state-variables":
        return this.checkUnusedStateVariables(code);
      case "repeated-external-calls":
        return this.checkRepeatedExternalCalls(code);
      case "unsafe-delegatecall":
        return this.checkUnsafeDelegatecall(code);
      case "large-storage-arrays":
        return this.checkLargeStorageArrays(code);
      case "missing-access-modifiers":
        return this.checkMissingAccessModifiers(code);
      default:
        return [];
    }
  }

  private checkRepeatedExternalCalls(code: string): RuleViolation[] {
    const out: RuleViolation[] = [];
    const calls = code.match(/(\w+)\s*\.\s*call\s*\(/g) || [];
    const seen = new Set<string>();
    for (const call of calls) {
      if (seen.has(call)) {
        out.push({
          ruleName: "repeated-external-calls",
          description: `Repeated external call pattern detected: ${call.trim()}`,
          severity: "warning",
          lineNumber: 1,
          columnNumber: 0,
          suggestion:
            "Cache external call results in local variables when safe.",
        });
        break;
      }
      seen.add(call);
    }
    return out;
  }

  private checkUnsafeDelegatecall(code: string): RuleViolation[] {
    if (!/delegatecall\s*\(/.test(code)) return [];
    return [
      {
        ruleName: "unsafe-delegatecall",
        description:
          "delegatecall usage detected; validate target and calldata constraints.",
        severity: "error",
        lineNumber: 1,
        columnNumber: 0,
        suggestion:
          "Restrict delegatecall targets and avoid user-controlled delegatecall paths.",
      },
    ];
  }

  private checkLargeStorageArrays(code: string): RuleViolation[] {
    const out: RuleViolation[] = [];
    const storageArrays =
      code.match(
        /\w+\s*\[\]\s+(public|private|internal|external)?\s*\w+\s*;/g,
      ) || [];
    if (storageArrays.length >= 3 || /push\s*\(/.test(code)) {
      out.push({
        ruleName: "large-storage-arrays",
        description:
          "Potential large or unbounded storage array usage detected.",
        severity: "warning",
        lineNumber: 1,
        columnNumber: 0,
        suggestion:
          "Consider pagination, bounded collections, or indexing strategies.",
      });
    }
    return out;
  }

  private checkMissingAccessModifiers(code: string): RuleViolation[] {
    const out: RuleViolation[] = [];
    const risky =
      /(mint|burn|pause|unpause|upgrade|setAdmin|setOwner|withdraw|clawback)/i;
    const fnRe = /function\s+(\w+)\s*\([^)]*\)\s*(public|external)([^{};]*)\{/g;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(code)) !== null) {
      const fnName = m[1];
      const tail = m[3] || "";
      if (
        risky.test(fnName) &&
        !/(onlyOwner|onlyAdmin|require\s*\()/.test(tail)
      ) {
        out.push({
          ruleName: "missing-access-modifiers",
          description: `Sensitive function '${fnName}' may be missing access restrictions.`,
          severity: "warning",
          lineNumber: 1,
          columnNumber: 0,
          suggestion:
            "Add explicit access control (e.g., onlyOwner/onlyAdmin) and validation checks.",
        });
      }
    }
    return out;
  }

  private checkUnusedStateVariables(code: string): RuleViolation[] {
    const violations: RuleViolation[] = [];

    const structPattern =
      /#\[contract(?:type|impl)?\]\s*(?:pub\s+)?struct\s+(\w+)\s*\{([^}]*)\}/gs;
    const implPattern =
      /impl\s+(\w+)\s*\{([\s\S]*?)(?=\nimpl|\nstruct|\n#\[|$)/g;

    const structs = new Map<string, { fields: string[]; lineNumber: number }>();
    let match: RegExpExecArray | null;

    while ((match = structPattern.exec(code)) !== null) {
      const structName = match[1];
      const fieldsBlock = match[2];
      const lineNumber = code.substring(0, match.index).split("\n").length;

      const fieldPattern = /(?:pub\s+)?(\w+)\s*:/g;
      const fields: string[] = [];
      let fieldMatch: RegExpExecArray | null;

      while ((fieldMatch = fieldPattern.exec(fieldsBlock)) !== null) {
        fields.push(fieldMatch[1]);
      }

      structs.set(structName, { fields, lineNumber });
    }

    const usedFields = new Set<string>();

    while ((match = implPattern.exec(code)) !== null) {
      const implBlock = match[2];
      const selfFieldPattern = /self\.(\w+)/g;
      let selfMatch: RegExpExecArray | null;

      while ((selfMatch = selfFieldPattern.exec(implBlock)) !== null) {
        usedFields.add(selfMatch[1]);
      }
    }

    for (const [structName, { fields, lineNumber }] of structs) {
      for (const field of fields) {
        if (!usedFields.has(field)) {
          violations.push({
            ruleName: "unused-state-variables",
            description: `State variable '${field}' is declared but never used in contract '${structName}'. This wastes storage space and increases ledger rent costs.`,
            severity: "warning",
            lineNumber,
            columnNumber: 0,
            variableName: field,
            suggestion: `Consider removing the unused state variable '${field}' or implement functionality that uses it. If it's reserved for future use, add a comment explaining its purpose.`,
          });
        }
      }
    }

    return violations;
  }
}
