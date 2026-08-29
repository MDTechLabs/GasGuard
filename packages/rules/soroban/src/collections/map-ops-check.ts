/**
 * Rule: Detect Inefficient Soroban Map Operations
 *
 * Repeated lookups and unnecessary map mutations increase contract resource
 * consumption in Soroban. Each host-object map access is metered.
 *
 * Issue: #768
 */

export interface MapOpsWarning {
  line: number;
  column?: number;
  patternType: 'repeated-lookup' | 'unnecessary-update' | 'avoidable-traversal';
  key?: string;
  message: string;
  suggestion: string;
}

export class SorobanMapOpsCheckRule {
  public static readonly RULE_ID = 'soroban-inefficient-map-ops';

  /** Map get patterns – each lookup is a metered host call. */
  private static readonly LOOKUP_PATTERNS = [
    '.get(',
    '.contains_key(',
    '.try_get(',
  ];

  /** Mutation patterns that write the same entry without guard. */
  private static readonly UPDATE_PATTERNS = [
    '.set(',
    '.insert(',
    '.put(',
  ];

  /** Full traversal of a Map is expensive due to host-object iteration cost. */
  private static readonly TRAVERSAL_PATTERNS = [
    '.iter()',
    '.keys()',
    '.values()',
    '.into_iter()',
  ];

  public analyze(sourceCode: string): MapOpsWarning[] {
    const warnings: MapOpsWarning[] = [];
    const lines = sourceCode.split('\n');

    // Track lookup keys per function to detect repeated lookups for the same key
    const lookupKeysPerFunction: Map<string, Map<string, number>> = new Map();
    let currentFunction = '<global>';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Track function scope
      const fnMatch = line.match(/\bfn\s+([a-zA-Z0-9_]+)\s*\(/);
      if (fnMatch) {
        currentFunction = fnMatch[1];
        if (!lookupKeysPerFunction.has(currentFunction)) {
          lookupKeysPerFunction.set(currentFunction, new Map());
        }
      }

      // 1. Repeated lookup for the same key
      for (const pattern of SorobanMapOpsCheckRule.LOOKUP_PATTERNS) {
        if (line.includes(pattern)) {
          // Extract the key argument (rough heuristic: text inside first parens)
          const keyMatch = line.match(/\.(?:get|contains_key|try_get)\(([^)]+)\)/);
          const key = keyMatch ? keyMatch[1].trim() : 'unknown';

          const fnKeys = lookupKeysPerFunction.get(currentFunction) ?? new Map<string, number>();
          const count = (fnKeys.get(key) ?? 0) + 1;
          fnKeys.set(key, count);
          lookupKeysPerFunction.set(currentFunction, fnKeys);

          if (count > 1) {
            warnings.push({
              line: lineNum,
              patternType: 'repeated-lookup',
              key,
              message: `Key '${key}' is looked up more than once in function '${currentFunction}'. Each map lookup is a metered host call.`,
              suggestion: `Cache the result of the first lookup in a local variable and reuse it instead of calling .get(${key}) again.`,
            });
          }
          break;
        }
      }

      // 2. Unnecessary update – set() called without a prior guard/condition check
      for (const pattern of SorobanMapOpsCheckRule.UPDATE_PATTERNS) {
        if (line.includes(pattern)) {
          // Warn if the set/insert is NOT preceded by a contains_key check on the same line
          // or the immediately preceding lines (simple heuristic).
          const prevLines = lines.slice(Math.max(0, i - 3), i).join('\n');
          if (!prevLines.includes('contains_key') && !prevLines.includes('if ') && !prevLines.includes('match ')) {
            warnings.push({
              line: lineNum,
              patternType: 'unnecessary-update',
              message: `Unconditional map update ('${pattern.trim()}') without a prior existence check may overwrite existing values unnecessarily, wasting metered write budget.`,
              suggestion:
                'Guard the update with a .contains_key() check or use an entry-based pattern to avoid redundant writes.',
            });
          }
          break;
        }
      }

      // 3. Avoidable full traversal
      for (const pattern of SorobanMapOpsCheckRule.TRAVERSAL_PATTERNS) {
        if (line.includes(pattern)) {
          warnings.push({
            line: lineNum,
            patternType: 'avoidable-traversal',
            message: `Full map traversal ('${pattern.trim()}') in function '${currentFunction}' is expensive. Iterating over a Soroban Map enumerates all host objects.`,
            suggestion:
              'Access only the specific keys you need via direct .get() calls, or restructure data to avoid full traversal.',
          });
          break;
        }
      }
    }

    return warnings;
  }
}
