import { maskNonCode, extractFunctions } from '../../common/source-utils';

export interface TokenMethodSignature {
  name: string;
  params: string[];
  returnType: string;
  line: number;
}

export interface CompatibilityIssue {
  severity: 'error' | 'warning' | 'info';
  method: string;
  message: string;
  line: number;
}

export interface InterfaceCheckResult {
  foundMethods: TokenMethodSignature[];
  expectedMethods: string[];
  missingMethods: string[];
  extraMethods: string[];
  issues: CompatibilityIssue[];
  isFullyCompatible: boolean;
  coveragePercent: number;
}

const STANDARD_TOKEN_METHODS: Record<string, { params: string[]; returnType: string }> = {
  balance: { params: ['Address'], returnType: 'i128' },
  transfer: { params: ['Address', 'Address', 'i128'], returnType: 'i128' },
  transfer_from: { params: ['Address', 'Address', 'Address', 'i128'], returnType: 'i128' },
  approve: { params: ['Address', 'Address', 'i128', 'u32'], returnType: 'i128' },
  allowance: { params: ['Address', 'Address'], returnType: 'i128' },
  approve_from: { params: ['Address', 'Address', 'Address', 'i128', 'u32'], returnType: 'i128' },
};

const STANDARD_METHOD_NAMES = Object.keys(STANDARD_TOKEN_METHODS);

function parseFunctionSignature(line: string): TokenMethodSignature | null {
  const match = line.match(
    /pub\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?/,
  );
  if (!match) return null;

  const name = match[1];
  const rawParams = match[2]
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const params = rawParams
    .filter((p) => !p.startsWith('env') && !p.startsWith('&env'))
    .map((p) => {
      const parts = p.split(':');
      return parts.length > 1 ? parts[parts.length - 1].trim().replace('&', '') : 'unknown';
    });

  const returnType = match[3] ?? 'void';
  return { name, params, returnType, line: 0 };
}

export function extractTokenFunctionSignatures(source: string): TokenMethodSignature[] {
  const masked = maskNonCode(source);
  const fns = extractFunctions(masked, source);
  const results: TokenMethodSignature[] = [];

  for (const fn of fns) {
    const preceding = source.slice(Math.max(0, fn.bodyStart - 300), fn.bodyStart + 1);
    const sigMatch = preceding.match(
      /pub\s+fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?\s*\{?\s*$/,
    );
    if (!sigMatch) continue;

    const rawParams = sigMatch[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const params = rawParams
      .filter((p) => !p.match(/^env\s*:/i) && !p.match(/^&?env\b/i))
      .map((p) => {
        const parts = p.split(':');
        return parts.length > 1
          ? parts[parts.length - 1].trim().replace(/&/g, '')
          : 'unknown';
      });

    const returnType = sigMatch[3] ?? 'void';
    results.push({ name: fn.name, params, returnType, line: fn.line });
  }

  return results;
}

function checkParamCompatibility(
  found: string[],
  expected: string[],
  methodName: string,
): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  if (found.length !== expected.length) {
    issues.push({
      severity: 'warning',
      method: methodName,
      message: `Expected ${expected.length} parameter(s) but found ${found.length}`,
      line: 0,
    });
  }

  const len = Math.min(found.length, expected.length);
  for (let i = 0; i < len; i++) {
    if (found[i] !== expected[i]) {
      issues.push({
        severity: 'warning',
        method: methodName,
        message: `Parameter ${i + 1}: expected '${expected[i]}' but found '${found[i]}'`,
        line: 0,
      });
    }
  }

  return issues;
}

export function checkTokenInterface(source: string): InterfaceCheckResult {
  const methods = extractTokenFunctionSignatures(source);
  const methodNames = methods.map((m) => m.name);
  const foundStandard = methodNames.filter((n) => STANDARD_METHOD_NAMES.includes(n));
  const missing = STANDARD_METHOD_NAMES.filter((n) => !methodNames.includes(n));
  const extra = methodNames.filter((n) => !STANDARD_METHOD_NAMES.includes(n));

  const issues: CompatibilityIssue[] = [];

  for (const method of methods) {
    const expected = STANDARD_TOKEN_METHODS[method.name];
    if (expected) {
      issues.push(...checkParamCompatibility(method.params, expected.params, method.name));

      if (method.returnType !== expected.returnType) {
        issues.push({
          severity: 'warning',
          method: method.name,
          message: `Return type: expected '${expected.returnType}' but found '${method.returnType}'`,
          line: method.line,
        });
      }
    }
  }

  for (const m of missing) {
    const expected = STANDARD_TOKEN_METHODS[m];
    issues.push({
      severity: 'error',
      method: m,
      message: `Missing standard token method '${m}'(${expected.params.join(', ')}): ${expected.returnType}`,
      line: 0,
    });
  }

  if (extra.length > 0) {
    issues.push({
      severity: 'info',
      method: extra.join(', '),
      message: `Non-standard method(s) found: ${extra.join(', ')}`,
      line: 0,
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const coveragePercent =
    STANDARD_METHOD_NAMES.length > 0
      ? Math.round((foundStandard.length / STANDARD_METHOD_NAMES.length) * 100)
      : 0;

  return {
    foundMethods: methods,
    expectedMethods: STANDARD_METHOD_NAMES,
    missingMethods: missing,
    extraMethods: extra,
    issues,
    isFullyCompatible: missing.length === 0 && errorCount === 0,
    coveragePercent,
  };
}
