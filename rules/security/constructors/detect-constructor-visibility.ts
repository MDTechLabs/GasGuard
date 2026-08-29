/**
 * Detect Constructor Visibility Issues (#337)
 *
 * Solidity ≥ 0.7.0 removed constructor visibility modifiers (`public` /
 * `internal`). Using them in modern code causes a compilation error. In older
 * code (< 0.7.0) using `internal` on the constructor was the correct way to
 * mark a contract as abstract; using `public` was redundant because
 * constructors are always public by default.
 *
 * This rule flags:
 *  1. `constructor(...) public`  — redundant; `public` on a constructor has
 *     no effect and is rejected by Solidity ≥ 0.7.
 *  2. `constructor(...) internal` — valid only in Solidity < 0.7 to make the
 *     contract abstract; still confusing and unsupported in modern Solidity.
 *  3. Legacy `function ContractName(...)` constructors (Solidity < 0.4.22)
 *     that carry an explicit `public` or `internal` modifier — these are
 *     almost certainly stale patterns.
 *
 * Solidity pragma is extracted to give context-aware suggestions.
 */

export type ConstructorVisibilityKind =
  | 'constructor-public'
  | 'constructor-internal'
  | 'legacy-constructor-public'
  | 'legacy-constructor-internal';

export interface ConstructorViolation {
  kind: ConstructorVisibilityKind;
  line: number;
  snippet: string;
  reason: string;
  fix: string;
}

export interface ConstructorVisibilityResult {
  detected: boolean;
  violations: ConstructorViolation[];
  solcVersion: string | null;
  message: string;
  suggestion: string;
}

// Matches `constructor ( ... ) [modifiers including public/internal]`
const CONSTRUCTOR_RE =
  /\bconstructor\s*\([^)]*\)[^{;]*?\b(public|internal)\b[^{;]*/g;

// Matches legacy `function <ContractName>(...) public/internal`
// We detect this by looking for a `contract Name` and then a `function Name(`
const CONTRACT_NAME_RE = /\bcontract\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

const PRAGMA_RE = /pragma\s+solidity\s+([^;]+);/;

const REASON_MAP: Record<ConstructorVisibilityKind, string> = {
  'constructor-public':
    '`public` on a constructor is redundant (constructors are always public) and a compile error in Solidity ≥ 0.7.0',
  'constructor-internal':
    '`internal` on a constructor is not valid in Solidity ≥ 0.7.0; use `abstract contract` instead',
  'legacy-constructor-public':
    'Legacy function-style constructor with `public` modifier is outdated; use the `constructor` keyword',
  'legacy-constructor-internal':
    'Legacy function-style constructor with `internal` modifier is outdated; use `abstract contract` with the `constructor` keyword',
};

const FIX_MAP: Record<ConstructorVisibilityKind, string> = {
  'constructor-public': 'Remove the `public` modifier from the constructor.',
  'constructor-internal':
    'Remove the `internal` modifier and declare the contract as `abstract contract`.',
  'legacy-constructor-public':
    'Replace the function-style constructor with `constructor(...)` and remove `public`.',
  'legacy-constructor-internal':
    'Replace the function-style constructor with `constructor(...)`, declare the contract `abstract`, and remove `internal`.',
};

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

function extractSolcVersion(code: string): string | null {
  const m = PRAGMA_RE.exec(code);
  return m ? m[1].trim() : null;
}

function stripComments(code: string): string {
  return code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

export function detectConstructorVisibility(
  code: string,
): ConstructorVisibilityResult {
  const violations: ConstructorViolation[] = [];
  const stripped = stripComments(code);
  const solcVersion = extractSolcVersion(stripped);

  // 1. Modern `constructor` keyword with visibility modifier
  let m: RegExpExecArray | null;
  CONSTRUCTOR_RE.lastIndex = 0;
  while ((m = CONSTRUCTOR_RE.exec(stripped)) !== null) {
    const modifier = m[1] as 'public' | 'internal';
    const kind: ConstructorVisibilityKind =
      modifier === 'public' ? 'constructor-public' : 'constructor-internal';
    const snippet = m[0].trim().split('\n')[0].trim();
    violations.push({
      kind,
      line: lineAt(code, m.index),
      snippet,
      reason: REASON_MAP[kind],
      fix: FIX_MAP[kind],
    });
  }

  // 2. Legacy function-style constructors: `function ContractName(`
  CONTRACT_NAME_RE.lastIndex = 0;
  let contractMatch: RegExpExecArray | null;
  while ((contractMatch = CONTRACT_NAME_RE.exec(stripped)) !== null) {
    const contractName = contractMatch[1];
    // Escape the name for use in a regex
    const legacyRe = new RegExp(
      `\\bfunction\\s+${contractName}\\s*\\([^)]*\\)[^{;]*?\\b(public|internal)\\b`,
      'g',
    );
    let legacyMatch: RegExpExecArray | null;
    while ((legacyMatch = legacyRe.exec(stripped)) !== null) {
      const modifier = legacyMatch[1] as 'public' | 'internal';
      const kind: ConstructorVisibilityKind =
        modifier === 'public'
          ? 'legacy-constructor-public'
          : 'legacy-constructor-internal';
      const snippet = legacyMatch[0].trim().split('\n')[0].trim();
      violations.push({
        kind,
        line: lineAt(code, legacyMatch.index),
        snippet,
        reason: REASON_MAP[kind],
        fix: FIX_MAP[kind],
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      solcVersion,
      message: 'No constructor visibility issues detected.',
      suggestion: '',
    };
  }

  const summary = violations
    .map((v) => `line ${v.line}: ${v.kind}`)
    .join('; ');

  return {
    detected: true,
    violations,
    solcVersion,
    message: `${violations.length} constructor visibility issue(s) detected: ${summary}.`,
    suggestion:
      'Remove visibility modifiers from constructors. In Solidity ≥ 0.7.0 they are illegal. For abstract contracts use `abstract contract`. For legacy code migrate to the `constructor` keyword.',
  };
}
