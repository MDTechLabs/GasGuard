export interface ResultTypesResult {
  detected: boolean;
  violations: Array<{
    functionName: string;
    callPattern: string;
    snippet: string;
  }>;
  message: string;
  suggestion: string;
}

const FALLIBLE_CALLS = [
  /\.unwrap\s*\(\)/g,
  /\.expect\s*\([^)]*\)/g,
  /storage\.instance\(\)\.get\s*\([^)]*\)/g,
  /storage\.persistent\(\)\.get\s*\([^)]*\)/g,
  /storage\.temporary\(\)\.get\s*\([^)]*\)/g,
  /env\.invoke\s*\(/g,
  /invoke_contract\s*\(/g,
];

const RESULT_RETURN = /->\s*Result\s*</;

const ALTERNATIVE_HANDLING = /unwrap_or\s*\(|unwrap_or_else\s*\(|match|if let/;

export function detectMissingResultType(code: string): ResultTypesResult {
  const violations: ResultTypesResult['violations'] = [];

  const fnHeaders = [...code.matchAll(/fn\s+(\w+)\s*\([^)]*\)\s*(?:->\s*\w+(?:<[^>]*>)?)?\s*\{/g)];
  const usedFnNames = new Set(fnHeaders.map(m => m[1]));

  for (const fnMatch of fnHeaders) {
    const fnName = fnMatch[1];
    const fnStart = fnMatch.index ?? 0;

    let depth = 0;
    let opened = false;
    let fnEnd = code.length;
    for (let i = fnStart; i < code.length; i++) {
      if (code[i] === '{') { depth++; opened = true; }
      else if (code[i] === '}') {
        depth--;
        if (opened && depth === 0) { fnEnd = i + 1; break; }
      }
    }

    const fnBody = code.slice(fnStart, fnEnd);

    if (RESULT_RETURN.test(fnBody)) continue;

    for (const callPattern of FALLIBLE_CALLS) {
      const calls = [...fnBody.matchAll(callPattern)];
      if (calls.length === 0) continue;

      const callSnippet = calls[0][0].slice(0, 40);
      const surrounding = code.slice(Math.max(0, (calls[0].index ?? 0) - 20), (calls[0].index ?? 0) + 60);

      if (ALTERNATIVE_HANDLING.test(fnBody)) continue;

      violations.push({
        functionName: fnName,
        callPattern: callSnippet,
        snippet: surrounding.trim().slice(0, 80),
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'All fallible functions use Result return types.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    violations,
    message: `${violations.length} function(s) use fallible calls without returning Result.`,
    suggestion: 'Return Result<T, Error> from functions that perform storage reads, cross-contract calls, or unwrap/expect operations to propagate errors gracefully.',
  };
}
