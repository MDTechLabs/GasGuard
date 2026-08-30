import { StorageRuleViolation, RuleContext } from './types';

export class SorobanLedgerWriteCostRule {
  public static readonly RULE_ID = 'SOROBAN_STORAGE_LEDGER_WRITE_COST';
  public static readonly RULE_NAME = 'Soroban Ledger Write Cost';

  public evaluate(sourceCode: string, context?: RuleContext): StorageRuleViolation[] {
    const violations: StorageRuleViolation[] = [];
    const lines = sourceCode.split(/\r?\n/);

    const writeRegex = /(?:env\.)?storage\(\)\.(?:instance|persistent|temporary)\(\)\.(?:set|remove)\s*\(([^)]*)\)/g;
    const loopRegex = /\b(for\s+.*?\s+in\s+.*|while\s+.*|loop)\s*\{/;
    const fnRegex = /(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/;

    let currentFunction = 'global';
    let inLoop = false;
    let loopDepth = 0;
    let braceBalance = 0;
    const loopBraceLevels: number[] = [];

    const functionWriteCounts = new Map<string, Map<string, { count: number; firstLine: number }>>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const lineNum = i + 1;

      const fnMatch = trimmed.match(fnRegex);
      if (fnMatch) {
        currentFunction = fnMatch[1];
        if (!functionWriteCounts.has(currentFunction)) {
          functionWriteCounts.set(currentFunction, new Map());
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
      writeRegex.lastIndex = 0;
      while ((match = writeRegex.exec(line)) !== null) {
        const rawArgs = match[1] || '';
        const key = rawArgs.split(',')[0].replace(/^&/, '').trim() || `key_L${lineNum}`;

        // 1. Loop write violation (High severity)
        if (inLoop) {
          violations.push({
            ruleId: SorobanLedgerWriteCostRule.RULE_ID,
            ruleName: SorobanLedgerWriteCostRule.RULE_NAME,
            severity: 'high',
            message: `Ledger write for '${key}' inside loop in function '${currentFunction}'`,
            suggestion: `Accumulate changes in a local collection and write once after the loop to save ledger rent and write fees.`,
            line: lineNum,
            column: match.index + 1,
            key,
            functionName: currentFunction,
          });
        }

        // Track for repeated write checks
        if (!functionWriteCounts.has(currentFunction)) {
          functionWriteCounts.set(currentFunction, new Map());
        }
        const keyMap = functionWriteCounts.get(currentFunction)!;
        const entry = keyMap.get(key) || { count: 0, firstLine: lineNum };
        entry.count++;
        keyMap.set(key, entry);
      }
    }

    // 2. Repeated write violations (Medium severity)
    for (const [fn, keyMap] of functionWriteCounts.entries()) {
      for (const [key, data] of keyMap.entries()) {
        if (data.count > 1) {
          violations.push({
            ruleId: SorobanLedgerWriteCostRule.RULE_ID,
            ruleName: SorobanLedgerWriteCostRule.RULE_NAME,
            severity: 'medium',
            message: `Storage key '${key}' is written to ${data.count} times in function '${fn}'`,
            suggestion: `Consolidate intermediate state changes to '${key}' and commit once at the end of the function.`,
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
