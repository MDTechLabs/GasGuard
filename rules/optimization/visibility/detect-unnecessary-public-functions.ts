/**
 * Detect Unnecessary Public Functions (#338)
 *
 * Flags `public` functions in Solidity contracts that are only ever called
 * externally (i.e. never called internally by the same contract). Declaring
 * such functions as `external` is cheaper: external functions read their
 * arguments directly from calldata instead of copying them to memory, which
 * saves gas on every invocation.
 *
 * Detection strategy:
 *  1. Collect every `public` function name and full signature span.
 *  2. Remove the entire function signature from the source before searching
 *     for internal call sites (prevents the parameter list from matching).
 *  3. If the function name does not appear anywhere in the remaining source,
 *     it is never called internally and should be `external`.
 *
 * Limitations: purely regex-based — does not resolve inheritance or libraries.
 */

export interface PublicFunctionViolation {
  functionName: string;
  line: number;
  suggestion: string;
}

export interface UnnecessaryPublicResult {
  detected: boolean;
  violations: PublicFunctionViolation[];
  functionsScanned: number;
  message: string;
  suggestion: string;
}

// Matches `function <name>(...) public ...`
// Captures group 1 = function name
const PUBLIC_FN_RE =
  /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)[^{;]*\bpublic\b/g;

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

export function detectUnnecessaryPublicFunctions(
  code: string,
): UnnecessaryPublicResult {
  const violations: PublicFunctionViolation[] = [];
  let functionsScanned = 0;

  // Remove single-line and multi-line comments to avoid false matches.
  const stripped = code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const matches: Array<{ name: string; index: number; matchLen: number }> = [];
  let m: RegExpExecArray | null;
  PUBLIC_FN_RE.lastIndex = 0;
  while ((m = PUBLIC_FN_RE.exec(stripped)) !== null) {
    matches.push({ name: m[1], index: m.index, matchLen: m[0].length });
  }

  functionsScanned = matches.length;

  for (const { name, index, matchLen } of matches) {
    // Remove the entire declaration (signature line) so the function name
    // inside its own parameter list does not count as an internal call site.
    const withoutDecl =
      stripped.slice(0, index) + stripped.slice(index + matchLen);

    // An internal call looks like `name(` — possibly preceded by whitespace,
    // a dot (super.name), `this.name`, or the start of a statement.
    const callRe = new RegExp(`\\b${name}\\s*\\(`, 'g');
    const calledInternally = callRe.test(withoutDecl);

    if (!calledInternally) {
      violations.push({
        functionName: name,
        line: lineAt(code, index),
        suggestion: `Change \`public\` to \`external\` on \`${name}\` — it is never called internally and \`external\` reads arguments directly from calldata, saving gas.`,
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      functionsScanned,
      message:
        functionsScanned === 0
          ? 'No public functions found.'
          : 'All public functions are called internally; no visibility change needed.',
      suggestion: '',
    };
  }

  const names = violations.map((v) => v.functionName).join(', ');
  return {
    detected: true,
    violations,
    functionsScanned,
    message: `${violations.length} public function(s) are only called externally and should be \`external\`: ${names}.`,
    suggestion:
      'Replace `public` with `external` on functions that are never invoked from within the contract. `external` functions pass arguments via calldata (no memory copy), reducing gas costs.',
  };
}
