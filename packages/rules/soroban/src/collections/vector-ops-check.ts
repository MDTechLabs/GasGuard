/**
 * Rule: Detect Inefficient Soroban Vector Operations
 *
 * Repeated vector traversal, front insertion/removal, and unnecessary copying
 * increase metered CPU and memory budget in Soroban contracts.
 *
 * Issue: #767
 */

export interface VectorOpsWarning {
  line: number;
  column?: number;
  patternType: 'repeated-traversal' | 'inefficient-insertion' | 'unnecessary-copy';
  symbol?: string;
  message: string;
  suggestion: string;
}

export class SorobanVectorOpsCheckRule {
  public static readonly RULE_ID = 'soroban-inefficient-vector-ops';

  /**
   * Patterns that indicate a full vector traversal (O(n) scan).
   * In Soroban, each host-object access is metered.
   */
  private static readonly TRAVERSAL_PATTERNS = [
    '.iter()',
    '.iter_mut()',
    '.into_iter()',
    '.for_each(',
    'for ',
  ];

  /**
   * Insertion/removal at the front is O(n) for Vec – push_back / push_front
   * differ in cost on Soroban host vectors.
   */
  private static readonly INEFFICIENT_INSERT_PATTERNS = [
    '.push_front(',
    '.insert(0,',
    '.remove(0)',
  ];

  /** Unnecessary clone / copy of an entire vector. */
  private static readonly COPY_PATTERNS = [
    '.clone()',
    'Vec::from(',
    '.to_vec()',
  ];

  public analyze(sourceCode: string): VectorOpsWarning[] {
    const warnings: VectorOpsWarning[] = [];
    const lines = sourceCode.split('\n');

    // Track traversal counts per function to detect repeated traversals
    const traversalCountPerFunction: Map<string, number> = new Map();
    let currentFunction = '<global>';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Detect function boundaries (rough heuristic)
      const fnMatch = line.match(/\bfn\s+([a-zA-Z0-9_]+)\s*\(/);
      if (fnMatch) {
        currentFunction = fnMatch[1];
        if (!traversalCountPerFunction.has(currentFunction)) {
          traversalCountPerFunction.set(currentFunction, 0);
        }
      }

      // 1. Repeated vector traversal
      for (const pattern of SorobanVectorOpsCheckRule.TRAVERSAL_PATTERNS) {
        if (line.includes(pattern)) {
          const count = (traversalCountPerFunction.get(currentFunction) ?? 0) + 1;
          traversalCountPerFunction.set(currentFunction, count);

          if (count > 1) {
            warnings.push({
              line: lineNum,
              patternType: 'repeated-traversal',
              symbol: currentFunction,
              message: `Function '${currentFunction}' performs multiple vector traversals. Each traversal consumes metered Soroban CPU budget.`,
              suggestion:
                'Combine traversals into a single pass or cache intermediate results in a local variable.',
            });
          }
          break;
        }
      }

      // 2. Inefficient insertion / removal
      for (const pattern of SorobanVectorOpsCheckRule.INEFFICIENT_INSERT_PATTERNS) {
        if (line.includes(pattern)) {
          warnings.push({
            line: lineNum,
            patternType: 'inefficient-insertion',
            message: `Front insertion/removal ('${pattern.trim()}') on a vector is O(n) and shifts all elements, wasting metered CPU.`,
            suggestion:
              'Use push_back() for appending, or consider a different data structure (e.g., a Map) if random access is needed.',
          });
          break;
        }
      }

      // 3. Unnecessary copy
      for (const pattern of SorobanVectorOpsCheckRule.COPY_PATTERNS) {
        if (line.includes(pattern) && line.includes('Vec')) {
          warnings.push({
            line: lineNum,
            patternType: 'unnecessary-copy',
            message: `Unnecessary vector copy detected ('${pattern.trim()}'). Cloning a Soroban Vec allocates a new host object and doubles memory budget consumption.`,
            suggestion:
              'Pass a reference or slice instead of cloning the entire vector where ownership is not strictly required.',
          });
          break;
        }
      }
    }

    return warnings;
  }
}
