/**
 * Detect Inefficient Symbol Usage (#374)
 * Flags repeated inline Symbol construction that could be replaced with static references.
 */

export interface SymbolUsageResult {
  detected: boolean;
  repeated: string[];
  message: string;
  suggestion: string;
}

export function detectInefficientSymbolUsage(code: string): SymbolUsageResult {
  const matches = [...code.matchAll(/Symbol::new\(\s*&env\s*,\s*["']([^"']+)["']\s*\)/g)];
  const names = matches.map((m) => m[1]);

  const counts: Record<string, number> = {};
  for (const name of names) {
    counts[name] = (counts[name] ?? 0) + 1;
  }

  const repeated = Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  if (repeated.length === 0) {
    return { detected: false, repeated: [], message: 'No repeated symbol construction found.', suggestion: '' };
  }

  return {
    detected: true,
    repeated,
    message: `Symbol(s) constructed multiple times: ${repeated.join(', ')}.`,
    suggestion: 'Define symbols as constants or lazy statics to avoid repeated allocation overhead.',
  };
}
