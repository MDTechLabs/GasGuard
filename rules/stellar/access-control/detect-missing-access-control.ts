/**
 * Detect Missing Soroban Access Control Layers (#375)
 * Flags privileged functions that expose sensitive operations without role validation.
 */

export interface AccessControlResult {
  detected: boolean;
  flaggedFunctions: string[];
  message: string;
  suggestion: string;
}

const PRIVILEGED_PATTERNS = [
  /fn\s+(set_admin|transfer_admin|withdraw|pause|unpause|mint|burn|upgrade)\s*\(/g,
];

const AUTH_GUARD = /require_auth|only_admin|assert_owner|has_role/;

export function detectMissingAccessControl(code: string): AccessControlResult {
  const flaggedFunctions: string[] = [];

  for (const pattern of PRIVILEGED_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const fnName = match[1];
      // Extract a small window of code after the function signature to check for an auth guard
      const startIdx = match.index ?? 0;
      let nextFn = code.indexOf(' fn ', startIdx + 5);
      let nextPubFn = code.indexOf('pub fn ', startIdx + 5);
      let endIdx = startIdx + 300;
      if (nextFn !== -1 && nextPubFn !== -1) {
          endIdx = Math.min(nextFn, nextPubFn);
      } else if (nextFn !== -1) {
          endIdx = nextFn;
      } else if (nextPubFn !== -1) {
          endIdx = nextPubFn;
      }
      const window = code.slice(startIdx, endIdx);
      if (!AUTH_GUARD.test(window)) {
        flaggedFunctions.push(fnName);
      }
    }
  }

  if (flaggedFunctions.length === 0) {
    return { detected: false, flaggedFunctions: [], message: 'Access control present on all privileged functions.', suggestion: '' };
  }

  return {
    detected: true,
    flaggedFunctions,
    message: `Privileged function(s) lack access control: ${flaggedFunctions.join(', ')}.`,
    suggestion: 'Add `require_auth()` or an admin role check at the start of each privileged function.',
  };
}
