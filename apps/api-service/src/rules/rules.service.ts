import { Injectable } from '@nestjs/common';
import { RuleDefinition } from './interfaces/rules.interface';
import { RuleViolation } from '../scanner/interfaces/scanner.interface';

@Injectable()
export class RulesService {
  private readonly rules: RuleDefinition[] = [
    {
      name: 'unused-state-variables',
      description:
        'Identifies state variables in Soroban contracts that are never read or written to, helping developers minimize storage footprint and ledger rent.',
      severity: 'warning',
      category: 'storage-optimization',
      enabled: true,
      documentationUrl:
        'https://gasguard.dev/rules/unused-state-variables',
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
      case 'unused-state-variables':
        return this.checkUnusedStateVariables(code);
      default:
        return [];
    }
  }

  private checkUnusedStateVariables(code: string): RuleViolation[] {
    const violations: RuleViolation[] = [];

    const structPattern = /#\[contract(?:type|impl)?\]\s*(?:pub\s+)?struct\s+(\w+)\s*\{([^}]*)\}/gs;
    const implPattern = /impl\s+(\w+)\s*\{([\s\S]*?)(?=\nimpl|\nstruct|\n#\[|$)/g;

    const structs = new Map<string, { fields: string[]; lineNumber: number }>();
    let match: RegExpExecArray | null;

    while ((match = structPattern.exec(code)) !== null) {
      const structName = match[1];
      const fieldsBlock = match[2];
      const lineNumber = code.substring(0, match.index).split('\n').length;

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
            ruleName: 'unused-state-variables',
            description: `State variable '${field}' is declared but never used in contract '${structName}'. This wastes storage space and increases ledger rent costs.`,
            severity: 'warning',
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
