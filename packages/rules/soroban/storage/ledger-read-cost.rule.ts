import { StorageRuleViolation, RuleContext } from './types';

export class SorobanLedgerReadCostRule {
  public static readonly RULE_ID = 'SOROBAN_STORAGE_LEDGER_READ_COST';
  public static readonly RULE_NAME = 'Soroban Ledger Read Cost';

  public evaluate(sourceCode: string, context?: RuleContext): StorageRuleViolation[] {
    const violations: StorageRuleViolation[] = [];
    const lines = sourceCode.split(/\r?\n/);

    const readRegex = /(?:env\.)?storage\(\)\.(?:instance|persistent|temporary)\(\)\.(?:get|has)\s*\(([^)]*)\)/g;
    const loopRegex = /\b(for\s+.*?\s+in\s+.*|while\s+.*|loop)\s*\{/;
    const fnRegex = /(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/;

    let currentFunction = 'global';
    let inLoop = false;
    let loopDepth = 0;
    let braceBalance = 0;
    const loopBraceLevels: number[] = [];

    const functionReadCounts = new Map<string, Map<string, { count: number; firstLine: number }>>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      const fnMatch = trimmed.match(fnRegex);
      if (fnMatch) {
        currentFunction = fnMatch[1];
        if (!functionReadCounts.has(currentFunction)) {
          functionReadCounts.set(currentFunction, new Map());
        }
      }

      if (loopRegex.test(trimmed)) {
        loopDepth++;
        inLoop = true;
        loopBraceLevels.push(braceBalance);
      }

      for (const char of line) {
        if (char === '{') braceBalance++;
        if (char === '}') {
          braceBalance--;
          if (loopBraceLevels.length > 0 && braceBalance <= loopBraceLevels[loopBraceLevels.length - 1]) {
            loopBraceLevels.pop();
            loopDepth = loopBraceLevels.length;
            inLoop = loopDepth > 0;
          }
        }
      }

      let match: RegExpExecArray | null;
      readRegex.lastIndex = 0;
      while ((match = readRegex.exec(line)) !== null) {
        const rawKey = (match[1] || '').replace(/^&/, '').trim();
        const key = rawKey || `key_L${lineNum}`;

        // 1. Loop read violation (High severity)
        if (inLoop) {
          violations.push({
            ruleId: SorobanLedgerReadCostRule.RULE_ID,
            ruleName: SorobanLedgerReadCostRule.RULE_NAME,
            severity: 'high',
            message: `Ledger read for '${key}' inside loop in function '${currentFunction}'`,
            suggestion: `Hoist the read for '${key}' outside the loop to avoid repeated per-iteration ledger metering.`,
            line: lineNum,
            column: match.index + 1,
            key,
            functionName: currentFunction,
          });
        }

        // Track for repeated read checks
        if (!functionReadCounts.has(currentFunction)) {
          functionReadCounts.set(currentFunction, new Map());
        }
        const keyMap = functionReadCounts.get(currentFunction)!;
        const entry = keyMap.get(key) || { count: 0, firstLine: lineNum };
        entry.count++;
        keyMap.set(key, entry);
      }
    }

    // 2. Repeated read violations (Medium severity)
    for (const [fn, keyMap] of functionReadCounts.entries()) {
      for (const [key, data] of keyMap.entries()) {
        if (data.count > 1) {
          violations.push({
            ruleId: SorobanLedgerReadCostRule.RULE_ID,
            ruleName: SorobanLedgerReadCostRule.RULE_NAME,
            severity: 'medium',
            message: `Storage key '${key}' is read ${data.count} times in function '${fn}' without local caching`,
            suggestion: `Cache '${key}' in a local let binding to eliminate repeated storage reads.`,
            line: data.firstLine,
            key,
            functionName: fn,
          });
        }
      }
    }

    return violations;
  }
}
