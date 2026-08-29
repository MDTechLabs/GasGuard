/**
 * Detect Unsafe Cross-Contract Invocation (#378)
 * Flags cross-contract calls that lack caller validation or return-value checks.
 */

export interface CrossContractResult {
  detected: boolean;
  message: string;
  suggestion: string;
}

const INVOCATION_PATTERNS = [
  /invoke_contract\s*\(/,
  /Client::new\s*\(/,
  /env\.invoke\s*\(/,
  /call_contract\s*\(/,
];

const VALIDATION_PATTERNS = [
  /require_auth/,
  /verify_contract/,
  /\.unwrap_or_else/,
  /\.expect\s*\(/,
  /match\s+.*\{/,
];

export function detectUnsafeCrossContractInvocation(code: string): CrossContractResult {
  const hasInvocation = INVOCATION_PATTERNS.some((p) => p.test(code));

  if (!hasInvocation) {
    return { detected: false, message: 'No cross-contract invocations found.', suggestion: '' };
  }

  const hasValidation = VALIDATION_PATTERNS.some((p) => p.test(code));

  if (!hasValidation) {
    return {
      detected: true,
      message: 'Cross-contract invocation detected without caller validation or result verification.',
      suggestion: 'Validate the callee address and handle invocation results explicitly to prevent unexpected behaviour.',
    };
  }

  return { detected: false, message: 'Cross-contract invocation appears guarded.', suggestion: '' };
}
