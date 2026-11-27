/**
 * Detect Unsafe Cross-Contract Invocation (#378)
 * Flags cross-contract calls that lack caller validation or return-value checks.
 */

export interface CrossContractResult {
  detected: boolean;
  message: string;
  suggestion: string;
  flaggedFunctions: string[];
}

const INVOCATION_PATTERNS = [
  /invoke_contract\s*\(/,
  /Client::new\s*\(/,
  /env\.invoke\s*\(/,
  /call_contract\s*\(/,
  /\.invoke\s*\(/,
];

const VALIDATION_PATTERNS = [
  /require_auth/,
  /verify_contract/,
  /\.unwrap_or_else/,
  /\.map_err\s*\(/,
  /\.expect\s*\(/,
  /\?\s*;?/,
  /match\s+.*\{/,
];

export function detectUnsafeCrossContractInvocation(code: string): CrossContractResult {
  const functions = Array.from(code.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g));
  const flaggedFunctions: string[] = [];

  if (functions.length === 0) {
    const hasInvocation = INVOCATION_PATTERNS.some((pattern) => pattern.test(code));
    const hasValidation = VALIDATION_PATTERNS.some((pattern) => pattern.test(code));
    return {
      detected: hasInvocation && !hasValidation,
      message: !hasInvocation
        ? 'No cross-contract invocations found.'
        : hasValidation
          ? 'Cross-contract invocation appears guarded.'
          : 'Cross-contract invocation detected without caller validation or result verification.',
      suggestion: hasInvocation && !hasValidation
        ? 'Validate the callee address and handle invocation results explicitly to prevent unexpected behaviour.'
        : '',
      flaggedFunctions: [],
    };
  }

  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];
    const start = fn.index ?? 0;
    const end = functions[i + 1]?.index ?? code.length;
    const body = code.slice(start, end);
    if (!INVOCATION_PATTERNS.some((pattern) => pattern.test(body))) continue;
    if (!VALIDATION_PATTERNS.some((pattern) => pattern.test(body))) {
      flaggedFunctions.push(fn[1]);
    }
  }

  if (flaggedFunctions.length > 0) {
    return {
      detected: true,
      message: 'Cross-contract invocation detected without caller validation or result verification.',
      suggestion: 'Validate the callee address and handle invocation results explicitly to prevent unexpected behaviour.',
      flaggedFunctions,
    };
  }

  return {
    detected: false,
    message: functions.some((fn, i) => {
      const start = fn.index ?? 0;
      const end = functions[i + 1]?.index ?? code.length;
      return INVOCATION_PATTERNS.some((pattern) => pattern.test(code.slice(start, end)));
    })
      ? 'Cross-contract invocation appears guarded.'
      : 'No cross-contract invocations found.',
    suggestion: '',
    flaggedFunctions: [],
  };
}
