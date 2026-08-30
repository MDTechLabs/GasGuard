/**
 * Issue #898 — Implement Soroban Signature Verification Analyzer
 *
 * Detects signature verification operations, identifies repeated operations,
 * analyzes verification inputs, and reports suspicious or redundant patterns.
 */

import {
  maskNonCode,
  extractFunctions,
  blockStackAt,
  isInLoop,
  extractArgs,
  splitArgs,
} from '../../common/source-utils';

export type SigSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SignatureOperation {
  caller: string;
  line: number;
  verifier: string;
  payloadArg: string;
  signatureArg: string;
  publicKeyArg: string;
  inLoop: boolean;
}

export interface SignatureFinding {
  ruleId: 'soroban-signature-verification';
  severity: SigSeverity;
  line: number;
  message: string;
  recommendation: string;
  details: {
    caller: string;
    verifier: string;
    issueType: 'repeated_verification' | 'loop_embedded' | 'missing_domain_separator';
  };
}

export interface SignatureAnalysisReport {
  operations: SignatureOperation[];
  findings: SignatureFinding[];
  metrics: {
    totalSignatureVerifications: number;
    repeatedVerifications: number;
    loopVerifications: number;
  };
}

const SIG_VERIFY_RE = /(env\s*\.\s*crypto\s*\(\s*\)\s*\.\s*(ed25519_verify|secp256k1_[A-Za-z0-9_]+)|\b(ed25519_verify|verify_signature|verify_sig))\s*\(/g;

export function analyzeSignatureVerification(source: string): SignatureAnalysisReport {
  const masked = maskNonCode(source);
  const functions = extractFunctions(masked, source);

  const operations: SignatureOperation[] = [];
  const findings: SignatureFinding[] = [];

  let repeatedVerifications = 0;
  let loopVerifications = 0;

  for (const fn of functions) {
    const fnBodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const fnBodyOriginal = source.slice(fn.bodyStart, fn.bodyEnd);

    SIG_VERIFY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const fnOps: SignatureOperation[] = [];

    while ((m = SIG_VERIFY_RE.exec(fnBodyMasked)) !== null) {
      const matchOffset = fn.bodyStart + m.index;
      const stack = blockStackAt(masked, fn.bodyStart, matchOffset);
      const verifier = m[2] || m[3] || 'signature_verify';
      const openParen = matchOffset + m[0].length - 1;

      const argsText = extractArgs(masked, source, openParen).text;
      const parsedArgs = splitArgs(argsText);

      const line = source.slice(0, matchOffset).split('\n').length;
      const inLoop = isInLoop(stack);

      if (inLoop) loopVerifications++;

      const op: SignatureOperation = {
        caller: fn.name,
        line,
        verifier,
        publicKeyArg: parsedArgs[0] ?? 'unknown_pk',
        payloadArg: parsedArgs[1] ?? 'unknown_msg',
        signatureArg: parsedArgs[2] ?? 'unknown_sig',
        inLoop,
      };

      fnOps.push(op);
      operations.push(op);

      if (inLoop) {
        findings.push({
          ruleId: 'soroban-signature-verification',
          severity: 'high',
          line,
          message: `Expensive signature verification '${verifier}' detected inside loop in function '${fn.name}'.`,
          recommendation: 'Batch signature verifications or verify signatures outside the loop to optimize CPU/gas cost.',
          details: {
            caller: fn.name,
            verifier,
            issueType: 'loop_embedded',
          },
        });
      }

      // Check missing domain separator in payload
      const payloadStr = (parsedArgs[1] ?? '').toLowerCase();
      if (!payloadStr.includes('domain') && !payloadStr.includes('prefix') && !fnBodyOriginal.includes('domain')) {
        findings.push({
          ruleId: 'soroban-signature-verification',
          severity: 'medium',
          line,
          message: `Signature verification in '${fn.name}' does not appear to use a domain separator in the payload.`,
          recommendation: 'Prepend domain separation tags (e.g. contract ID, chain ID) to signed payloads to prevent cross-contract replay attacks.',
          details: {
            caller: fn.name,
            verifier,
            issueType: 'missing_domain_separator',
          },
        });
      }
    }

    // Check repeated verifications on identical payload/key
    for (let i = 0; i < fnOps.length; i++) {
      for (let j = i + 1; j < fnOps.length; j++) {
        if (
          fnOps[i].publicKeyArg === fnOps[j].publicKeyArg &&
          fnOps[i].payloadArg === fnOps[j].payloadArg
        ) {
          repeatedVerifications++;
          findings.push({
            ruleId: 'soroban-signature-verification',
            severity: 'critical',
            line: fnOps[j].line,
            message: `Redundant duplicate signature verification detected for payload '${fnOps[i].payloadArg}' in '${fn.name}' (first verified at line ${fnOps[i].line}).`,
            recommendation: 'Store signature verification result in a boolean local variable rather than re-executing cryptographic verification.',
            details: {
              caller: fn.name,
              verifier: fnOps[j].verifier,
              issueType: 'repeated_verification',
            },
          });
        }
      }
    }
  }

  return {
    operations,
    findings,
    metrics: {
      totalSignatureVerifications: operations.length,
      repeatedVerifications,
      loopVerifications,
    },
  };
}
