/**
 * GG-SIG-PACKED-001 — Detect unsafe `abi.encodePacked` hashing with dynamic values.
 *
 * `abi.encodePacked` concatenates operands without length prefixes or padding
 * for dynamic types (`string`, `bytes`, `T[]`). When two or more dynamic
 * operands appear in one preimage, field boundaries are ambiguous:
 * `encodePacked("ab", "c") == encodePacked("a", "bc")`. If that hash is used for
 * a signature digest, an authorization check, a commitment or a mapping key,
 * different logical inputs collide.
 *
 * Supported: Solidity 0.6 – 0.8.x source text. The detector is lexical and
 * intra-function: it resolves operand types from the enclosing function's
 * parameters and local declarations plus contract state variables, and
 * classifies each operand as fixed-width, dynamic, literal or unknown.
 *
 * Explicit limitations (see docs/rules/signature-and-cross-domain-message-security.md):
 *  - operands whose type cannot be resolved (struct members, call results,
 *    inherited state) are `unknown` and only produce low-confidence findings;
 *  - preimages assembled across function boundaries are not followed;
 *  - compiler settings (optimizer, via-IR) do not affect this rule.
 */

import {
  Confidence,
  Diagnostic,
  RuleResult,
  SecurityFinding,
  Severity,
  SolFunction,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findMatching,
  lineColumn,
  makeFinding,
  prepareSource,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-SIG-PACKED-001';

export type OperandClass = 'fixed' | 'dynamic' | 'literal' | 'unknown';

export interface PackedOperand {
  expression: string;
  type: string;
  class: OperandClass;
}

export interface SafeEncoding {
  line: number;
  reason: 'fixed-width' | 'single-dynamic' | 'delimited';
}

export interface PackedHashingResult extends RuleResult {
  /** Encodings that were examined and judged safe (for transparency). */
  safeEncodings: SafeEncoding[];
}

const FIXED_TYPE = /^(u?int\d*|bytes([1-9]|[12]\d|3[0-2])|address|bool)$/;
const NOT_A_TYPE = new Set(['return', 'emit', 'else', 'revert', 'delete', 'new', 'require', 'assert', 'if', 'for', 'while']);

export function classifyType(raw: string): OperandClass {
  const type = raw.replace(/\b(memory|calldata|storage|payable)\b/g, '').replace(/\s+/g, '').trim();
  if (type === 'string' || type === 'bytes') return 'dynamic';
  if (/\[\]$/.test(type)) return 'dynamic';
  if (FIXED_TYPE.test(type)) return 'fixed';
  if (/\[\d+\]$/.test(type)) return classifyType(type.replace(/\[\d+\]$/, ''));
  return 'unknown';
}

function splitWithOffsets(text: string, base: number): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (i === text.length || (c === ',' && depth === 0)) {
      const raw = text.slice(start, i);
      const lead = raw.length - raw.trimStart().length;
      if (raw.trim()) parts.push({ text: raw.trim(), offset: base + start + lead });
      start = i + 1;
    }
  }
  return parts;
}

function buildScope(fn: SolFunction, stateVars: Map<string, string>): Map<string, string> {
  const scope = new Map<string, string>(stateVars);
  for (const p of fn.params) if (p.name) scope.set(p.name, p.type);
  const decl = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\[\s*\d*\s*\])*)\s+(?:memory\s+|storage\s+|calldata\s+|payable\s+)?([A-Za-z_$][\w$]*)\s*(?==|;|,|\))/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(fn.body)) !== null) {
    if (!NOT_A_TYPE.has(m[1])) scope.set(m[2], m[1].replace(/\s+/g, ''));
  }
  return scope;
}

function classifyOperand(expression: string, original: string, scope: Map<string, string>): PackedOperand {
  const e = expression.trim();
  const make = (type: string, cls: OperandClass): PackedOperand => ({ expression: original.trim(), type, class: cls });
  if (/^["']/.test(e) || /^(hex|unicode)\s*["']/.test(e)) return make('string-literal', 'literal');
  if (/^(0x[0-9a-fA-F_]+|\d[\d_]*(e\d+)?)$/.test(e)) return make('number-literal', 'fixed');
  const cast = /^(address|bool|u?int\d*|bytes\d+|bytes|string)\s*\(/.exec(e);
  if (cast) {
    const t = cast[1];
    return make(t, classifyType(t));
  }
  if (/^abi\.encode\w*\s*\(/.test(e)) return make('bytes', 'dynamic');
  if (/^(msg\.sender|tx\.origin|block\.(timestamp|number|chainid|basefee)|address\s*\(\s*this\s*\))$/.test(e)) {
    return make(/block/.test(e) ? 'uint256' : 'address', 'fixed');
  }
  if (/\.length$/.test(e)) return make('uint256', 'fixed');
  const ident = /^([A-Za-z_$][\w$]*)$/.exec(e);
  if (ident && scope.has(ident[1])) {
    const t = scope.get(ident[1])!;
    return make(t, classifyType(t));
  }
  const index = /^([A-Za-z_$][\w$]*)\s*\[[^\]]*\]$/.exec(e);
  if (index && scope.has(index[1])) {
    const t = scope.get(index[1])!;
    if (/\]$/.test(t)) {
      const elem = t.replace(/\[[^\]]*\]$/, '');
      return make(elem, classifyType(elem));
    }
  }
  return make('unresolved', 'unknown');
}

interface Sink {
  hash: string;
  /** Offset (in the masked text) of the hashing expression start. */
  start: number;
  /** Offset just past the hashing expression's closing parenthesis. */
  end: number;
  boundVariable?: string;
}

function findSink(masked: string, fn: SolFunction, encStart: number, encEnd: number): Sink | undefined {
  const before = masked.slice(Math.max(0, encStart - 40), encStart);
  const wrapped = /\b(keccak256|sha256|ripemd160)\s*\(\s*$/.exec(before);
  if (wrapped) {
    const start = encStart - (before.length - wrapped.index);
    const open = masked.indexOf('(', start);
    const close = findMatching(masked, open, '(', ')');
    return { hash: wrapped[1], start, end: close === -1 ? encEnd : close + 1 };
  }
  const assigned = /\bbytes\s+(?:memory\s+)?([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before) ?? /([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
  if (assigned) {
    const name = assigned[1];
    const after = masked.slice(encEnd, fn.bodyOffset + fn.body.length);
    const use = new RegExp(`\\b(keccak256|sha256|ripemd160)\\s*\\(\\s*${name}\\s*\\)`).exec(after);
    if (use) {
      return { hash: use[1], start: encStart, end: encEnd, boundVariable: name };
    }
  }
  return undefined;
}

function priorityContext(
  masked: string,
  fn: SolFunction,
  sink: Sink,
): { severity: Severity; label: string; evidence: string } {
  const body = fn.body;
  const around = `${fn.name} ${body}`;
  const bound = sink.boundVariable ?? '';
  const lhs = /([A-Za-z_$][\w$]*)\s*=\s*$/.exec(masked.slice(Math.max(0, sink.start - 40), sink.start))?.[1] ?? '';
  const names = `${bound} ${lhs}`;
  if (
    /\b(ecrecover|ECDSA\.\w+|SignatureChecker\.\w+|isValidSignature|recover)\s*\(/.test(body) ||
    /[Ss]ignature|[Pp]ermit|[Dd]igest|[Ss]igner|[Ss]igned|(^|[^a-zA-Z])[Ss]ig([^a-zA-Z]|$)/.test(`${fn.name} ${names}`)
  ) {
    return { severity: 'high', label: 'signature digest', evidence: 'hash feeds signature recovery/verification or is named as a digest' };
  }
  if (/authori[sz]|whitelist|allowlist|MerkleProof|hasRole|isAuthorized|onlyRole/i.test(around)) {
    return { severity: 'high', label: 'authorization check', evidence: 'enclosing function performs an authorization decision' };
  }
  const before = masked.slice(Math.max(0, sink.start - 12), sink.start);
  const after = masked.slice(sink.end, sink.end + 12);
  if (/\[\s*$/.test(before) && /^\s*\]/.test(after)) {
    return { severity: 'medium', label: 'mapping key', evidence: 'hash is used directly as a mapping key' };
  }
  if (/commit|reveal|merkle|leaf|proof|salt/i.test(`${fn.name} ${names} ${body}`)) {
    return { severity: 'medium', label: 'commitment', evidence: 'enclosing function builds or checks a commitment/leaf' };
  }
  if (/\[[^\]]*$/.test(before) || /(^|\W)(id|key|slot)\b/i.test(names)) {
    return { severity: 'medium', label: 'identifier', evidence: 'hash result is bound to an identifier/key-like name' };
  }
  return { severity: 'low', label: 'general hash', evidence: 'no signature, authorization, commitment or mapping-key use was resolved' };
}

export function detectUnsafePackedHashing(input: unknown): PackedHashingResult {
  const prep = prepareSource(input);
  if (!prep.ok) {
    return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, safeEncodings: [] };
  }
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateVars = new Map<string, string>();
  for (const v of extractStateVars(masked, source, contracts)) stateVars.set(v.name, v.type);

  const findings: SecurityFinding[] = [];
  const safeEncodings: SafeEncoding[] = [];

  for (const fn of functions) {
    if (!fn.hasBody) continue;
    const scope = buildScope(fn, stateVars);
    const re = /\babi\s*\.\s*encodePacked\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fn.body)) !== null) {
      const encStart = fn.bodyOffset + m.index;
      const open = fn.bodyOffset + m.index + m[0].length - 1;
      const close = findMatching(masked, open, '(', ')');
      if (close === -1) {
        diagnostics.push({ level: 'warning', code: 'unterminated-encodePacked', message: 'abi.encodePacked call is not closed.', line: fn.line });
        continue;
      }
      const sink = findSink(masked, fn, encStart, close + 1);
      if (!sink) continue;
      const operands = splitWithOffsets(masked.slice(open + 1, close), open + 1).map((part) =>
        classifyOperand(part.text, source.slice(part.offset, part.offset + part.text.length), scope),
      );
      const dynamicIdx = operands.flatMap((o, i) => (o.class === 'dynamic' ? [i] : []));
      const unknownCount = operands.filter((o) => o.class === 'unknown').length;
      const { line } = lineColumn(source, encStart);

      if (dynamicIdx.length === 0 && unknownCount === 0) {
        safeEncodings.push({ line, reason: 'fixed-width' });
        continue;
      }
      if (dynamicIdx.length === 1 && unknownCount === 0) {
        safeEncodings.push({ line, reason: 'single-dynamic' });
        continue;
      }
      let delimited = dynamicIdx.length >= 2;
      for (let k = 1; k < dynamicIdx.length; k++) {
        const between = operands.slice(dynamicIdx[k - 1] + 1, dynamicIdx[k]);
        if (!between.some((o) => o.class === 'literal')) delimited = false;
      }
      if (delimited && unknownCount === 0) {
        safeEncodings.push({ line, reason: 'delimited' });
        continue;
      }

      const ctx = priorityContext(masked, fn, sink);
      const confidence: Confidence = dynamicIdx.length >= 2 ? 'high' : 'low';
      const evidence = [
        `operands: ${operands.map((o) => `${o.expression}:${o.type}(${o.class})`).join(', ')}`,
        `${dynamicIdx.length} dynamic operand(s), ${unknownCount} unresolved operand(s)`,
        `hashed with ${sink.hash}`,
      ];
      if (confidence === 'low') evidence.push('a single dynamic operand next to unresolved operands may still be ambiguous');
      const severity: Severity = confidence === 'low' && ctx.severity === 'high' ? 'medium' : ctx.severity;
      findings.push(
        makeFinding(source, encStart, {
          ruleId: RULE_ID,
          kind: 'ambiguous-packed-preimage',
          severity,
          confidence,
          contract: fn.contract,
          function: fn.name,
          message:
            `${sink.hash}(abi.encodePacked(...)) in ${fn.name}() concatenates ${dynamicIdx.length >= 2 ? 'multiple dynamic operands' : 'a dynamic operand with unresolved operands'} ` +
            `without delimiters; distinct inputs can produce the same preimage (${ctx.label}).`,
          severityRationale: `Used as ${ctx.label}: ${ctx.evidence}. A preimage collision lets an attacker substitute logically different inputs for one hash.`,
          confidenceEvidence: evidence,
          remediation:
            'Use abi.encode (length-prefixed and padded) instead of abi.encodePacked, or encode a fixed-width length before each dynamic operand. For signatures use EIP-712 typed data hashing.',
          details: { operands, hashFunction: sink.hash, usage: ctx.label },
        }),
      );
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, safeEncodings };
}
