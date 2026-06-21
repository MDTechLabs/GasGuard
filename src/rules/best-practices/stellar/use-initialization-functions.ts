export interface InitializationFunctionsResult {
  detected: boolean;
  violations: Array<{
    contractName: string;
    reason: string;
    snippet: string;
  }>;
  message: string;
  suggestion: string;
}

const CONTRACT_PATTERN = /(?:#\[contractimpl\]\s*)?(?:pub\s+)?(?:trait\s+\w+\s*\{[^}]*}\s*)?impl\s+(\w+)\s*(?:for\s+\w+)?\s*\{/g;

const CONSTRUCTORS = [
  /fn\s+__constructor\s*\(/,
  /fn\s+new\s*\(/,
  /fn\s+initialize\s*\(/,
  /fn\s+init\s*\(/,
];

const ADMIN_SETUP = /(?:set_admin|init_admin|initialize_admin)/;

const STORAGE_INIT = /storage\.instance\(\)\.set\s*\(/;

export function detectMissingInitialization(code: string): InitializationFunctionsResult {
  const violations: InitializationFunctionsResult['violations'] = [];

  const contractMatches = [...code.matchAll(CONTRACT_PATTERN)];
  const contractNames = contractMatches.map(m => m[1]);

  if (contractNames.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No contract implementations found.',
      suggestion: '',
    };
  }

  const hasConstructor = CONSTRUCTORS.some(p => p.test(code));
  const hasAdminSetup = ADMIN_SETUP.test(code);
  const hasStorageInit = STORAGE_INIT.test(code);

  for (const contractName of contractNames) {
    if (!hasConstructor) {
      if (hasStorageInit || hasAdminSetup) {
        violations.push({
          contractName,
          reason: 'contract performs storage initialization without a dedicated constructor',
          snippet: contractName,
        });
      }
    }
  }

  if (!hasConstructor && (hasStorageInit || hasAdminSetup) && violations.length === 0) {
    violations.push({
      contractName: contractNames[0],
      reason: 'no constructor found despite storage initialization in contract',
      snippet: contractNames[0],
    });
  }

  if (violations.length === 0 && !hasConstructor) {
    return {
      detected: false,
      violations: [],
      message: 'No initialization required or constructor present.',
      suggestion: '',
    };
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'Constructor or initialization function detected.',
      suggestion: '',
    };
  }

  return {
    detected: true,
    violations,
    message: `${violations.length} contract implementation(s) missing a proper constructor.`,
    suggestion: 'Add a __constructor() function annotated with #[contractimpl] to initialize admin, storage, and configuration values at deployment time.',
  };
}
