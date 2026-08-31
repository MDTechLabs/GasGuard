/**
 * Analyzer: Duplicate Soroban Signature Verification (#899)
 *
 * Detects duplicate or repeated signature verification calls executed on identical inputs
 * within the same function or execution context.
 */

export interface SignatureCallNode {
  functionName: string;
  line: number;
  verifier: string;
  inputs: string;
  fullCall: string;
}

export interface DuplicateSignatureFinding {
  line: number;
  functionName: string;
  verifier: string;
  inputs: string;
  firstLine: number;
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

const SIGNATURE_VERIFY_PATTERNS = [
  /ed25519_verify\s*\(([^)]+)\)/g,
  /secp256k1_verify\s*\(([^)]+)\)/g,
  /verify_signature\s*\(([^)]+)\)/g,
  /signature\.verify\s*\(([^)]+)\)/g,
  /check_auth\s*\(([^)]+)\)/g,
  /require_auth_for_args\s*\(([^)]+)\)/g,
  /verify\s*\(([^)]+)\)/g,
];

export class DuplicateSignatureAnalyzer {
  public analyze(sourceCode: string): DuplicateSignatureFinding[] {
    const findings: DuplicateSignatureFinding[] = [];
    const functions = this.extractFunctions(sourceCode);

    for (const fn of functions) {
      const calls = this.extractSignatureCalls(fn);
      const seen = new Map<string, SignatureCallNode>();

      for (const call of calls) {
        // Key based on verifier type and normalized inputs
        const normalizedInputs = call.inputs.replace(/\s+/g, '');
        const key = `${call.verifier}::${normalizedInputs}`;

        if (seen.has(key)) {
          const firstCall = seen.get(key)!;
          findings.push({
            line: call.line,
            functionName: fn.name,
            verifier: call.verifier,
            inputs: call.inputs,
            firstLine: firstCall.line,
            message: `Duplicate signature verification using '${call.verifier}' with inputs (${call.inputs}) in function '${fn.name}'. Previously verified at line ${firstCall.line}.`,
            suggestion: `Cache the result of the signature verification at line ${firstCall.line} or pass the verified boolean/context to avoid redundant verification overhead.`,
            severity: 'high',
          });
        } else {
          seen.set(key, call);
        }
      }
    }

    return findings;
  }

  private extractFunctions(source: string): Array<{ name: string; body: string; startLine: number }> {
    const blocks: Array<{ name: string; body: string; startLine: number }> = [];
    const fnHeaderRe = /\bfn\s+([a-zA-Z0-9_]+)\s*\([^)]*\)[^{]*\{/g;
    let match: RegExpExecArray | null;

    while ((match = fnHeaderRe.exec(source)) !== null) {
      const openPos = match.index + match[0].length - 1;
      const body = this.extractBraceBlock(source, openPos);
      if (!body) continue;

      const startLine = source.slice(0, match.index).split('\n').length;
      blocks.push({ name: match[1], body, startLine });
    }

    return blocks;
  }

  private extractSignatureCalls(fn: { name: string; body: string; startLine: number }): SignatureCallNode[] {
    const calls: SignatureCallNode[] = [];
    const lines = fn.body.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const currentLine = fn.startLine + i;

      for (const pattern of SIGNATURE_VERIFY_PATTERNS) {
        const regex = new RegExp(pattern.source, 'g');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(lineText)) !== null) {
          const verifier = match[0].split('(')[0].trim();
          const inputs = match[1] ? match[1].trim() : '';

          calls.push({
            functionName: fn.name,
            line: currentLine,
            verifier,
            inputs,
            fullCall: match[0],
          });
        }
      }
    }

    return calls;
  }

  private extractBraceBlock(source: string, openPos: number): string | null {
    let depth = 0;
    for (let i = openPos; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) return source.slice(openPos, i + 1);
      }
    }
    return null;
  }
}

export function analyzeDuplicateSignatures(sourceCode: string): DuplicateSignatureFinding[] {
  const analyzer = new DuplicateSignatureAnalyzer();
  return analyzer.analyze(sourceCode);
}
