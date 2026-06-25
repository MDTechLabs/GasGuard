/**
 * Detect unprotected initializers in Soroban contracts.
 *
 * Checks for:
 * 1. Missing constructor functions
 * 2. Initialization without access control
 * 3. Re-initialization vulnerabilities (lack of initialized flag)
 */

export interface InitializationRisk {
  type: 'missing-constructor' | 'unprotected-initializer' | 'reinitialization-vulnerability';
  severity: 'high' | 'critical';
  description: string;
  line?: number;
  suggestion: string;
}

export function detectInitializationRisks(sourceCode: string): InitializationRisk[] {
  const risks: InitializationRisk[] = [];
  const lines = sourceCode.split('\n');

  let hasConstructor = false;
  let hasInitFunction = false;
  let hasInitializedFlag = false;
  let hasRequireAuthInInit = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Detect constructor-like functions
    if (/\bfn\s+new\b/.test(line) || /fn\s+\w+_init\b/.test(line)) {
      hasConstructor = true;
      hasInitFunction = true;
    }

    // Detect initialize functions
    if (/\bfn\s+initialize\b/.test(line)) {
      hasInitFunction = true;
    }

    // Detect initialized flag check
    if (/INITIALIZED|initialized|_init\b/.test(line)) {
      hasInitializedFlag = true;
    }

    // Detect require_auth in init functions
    if ((hasInitFunction || hasConstructor) && /require_auth/.test(line)) {
      hasRequireAuthInInit = true;
    }
  }

  // Check for missing constructor
  if (!hasConstructor && !hasInitFunction) {
    risks.push({
      type: 'missing-constructor',
      severity: 'high',
      description: 'Contract lacks a constructor or initialization function. State may not be properly initialized.',
      suggestion: 'Add a "new" function that initializes contract state, or an "initialize" function with proper access control.',
    });
  }

  // Check for re-initialization vulnerability
  if (hasInitFunction && !hasInitializedFlag) {
    risks.push({
      type: 'reinitialization-vulnerability',
      severity: 'critical',
      description: 'Initialization function does not check an initialized flag. The contract could be re-initialized by an attacker.',
      suggestion: 'Add an initialized flag check at the start of the init function using env.storage().instance().has(&INITIALIZED).',
    });
  }

  // Check for unprotected initializer
  if (hasInitFunction && !hasRequireAuthInInit) {
    risks.push({
      type: 'unprotected-initializer',
      severity: 'high',
      description: 'Initialization function lacks caller authentication. Anyone could re-initialize the contract.',
      suggestion: 'Add require_auth() call at the beginning of the init function to ensure only authorized callers can initialize.',
    });
  }

  return risks;
}
