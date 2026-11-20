/**
 * Narrowing integer casts that truncate user-controlled values (#1368)
 *
 * Finds explicit down-casts such as `uint128(x)` where `x` is declared wider (for example
 * uint256), so values above the target maximum silently lose their high bits. A cast is treated
 * as protected when:
 *  - a dominating guard bounds the operand (`require(x <= type(uint128).max)`, a named MAX/limit),
 *  - the next statements verify a round trip (`require(uint256(y) == x)`), or
 *  - it is a checked-cast library call (SafeCast.toUint128 is not a raw cast and is never matched).
 * Findings are ranked by what the value influences: transfers, authorization checks and
 * accounting rank above identifiers and timestamps, which rank above everything else.
 *
 * Same-width sign changes (`uint256(int256)`) are covered by arith-signed-to-unsigned and skipped here.
 */
import {
  DetectorFinding,
  DetectorResult,
  IntTypeInfo,
  Statement,
  buildResult,
  collectAssignments,
  collectGuards,
  collectLocalTypes,
  collectStateTypes,
  derivedFrom,
  dominatingGuards,
  extractFunctions,
  failedResult,
  findMatching,
  intTypeInfo,
  isExternallyCallable,
  mentionsWord,
  splitStatements,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "arith-narrowing-cast";

export const LIMITATIONS = [
  "Source width comes from declarations in this file; operands of unknown type are reported only at low confidence and only for value-like names.",
  "A guard counts as a range check when its condition compares the operand with type(...).max, a MAX/limit/cap name or a numeric bound; the bound itself is not verified to fit the target type.",
  "Assembly casts and bit masks (x & 0xffff) are not analyzed.",
  "Packed-storage casts that are intentionally lossy (for example uint32(block.timestamp)) are reported at low severity.",
];

const SUGGESTION =
  "Use a checked cast (OpenZeppelin SafeCast.toUintN / toIntN) or require(value <= type(uintN).max) before the cast.";

const TRANSFER_RE = /\b(?:safeTransfer|safeTransferFrom|transfer|transferFrom|send|mint|burn|_mint|_burn)\s*\(|\.call\s*\{/;
const ACCOUNTING_RE = /(balance|supply|reserve|debt|shares?|collateral|principal|allowance|stake|reward)/i;
const AUTH_RE = /(msg\.sender\s*==|onlyOwner|onlyRole|hasRole|isOwner|owner\s*==|require\s*\([^)]*(?:role|auth|owner))/i;
const ID_RE = /(\bid\b|Id\b|index|nonce|tokenId|orderId)/;
const VALUE_NAME_RE = /(amount|value|balance|shares?|supply|fee|limit|price|timestamp|deadline|id|nonce|reserve)/i;

function sourceInfo(arg: string, types: Map<string, string>): IntTypeInfo | null {
  const trimmed = arg.trim();
  if (/block\.(timestamp|number)/.test(trimmed) || /msg\.value|\.length\b|\.balance\b|totalSupply\s*\(\s*\)|balanceOf\s*\(|gasleft\s*\(/.test(trimmed)) {
    return { signed: false, bits: 256 };
  }
  const nested = /^(u?int\d*)\s*\(/.exec(trimmed);
  if (nested) return intTypeInfo(nested[1]);
  let best: IntTypeInfo | null = null;
  for (const w of wordsIn(trimmed)) {
    const info = intTypeInfo(types.get(w) ?? "");
    if (info && (best === null || info.bits > best.bits)) best = info;
  }
  return best;
}

function isRangeBound(condition: string, operandWords: string[]): boolean {
  if (!/(<=|>=|<|>)/.test(condition)) return false;
  if (!operandWords.some((w) => mentionsWord(condition, w))) return false;
  return /type\s*\(\s*u?int\d*\s*\)\s*\.max|\b(?:MAX|max|Max|LIMIT|limit|Limit|CAP|cap|Cap)[\w]*|0x[0-9a-fA-F]+|\d+\s*(?:\*\*|e)\s*\d+|\b\d{3,}\b/.test(condition);
}

function hasRoundTrip(statements: Statement[], index: number, assigned: string | undefined, arg: string): boolean {
  if (!assigned) return false;
  for (let j = index + 1; j < Math.min(statements.length, index + 4); j++) {
    const t = statements[j].text;
    if (/==/.test(t) && mentionsWord(t, assigned) && wordsIn(arg).some((w) => mentionsWord(t, w))) return true;
  }
  return false;
}

export function detectNarrowingCastTruncation(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const stateTypes = collectStateTypes(v.clean);

  for (const fn of extractFunctions(v.clean)) {
    const statements = splitStatements(fn, v.clean);
    const assignments = collectAssignments(statements);
    const guards = collectGuards(statements);
    const types = new Map([...stateTypes, ...collectLocalTypes(fn, statements)]);
    const callerInputs = new Set(isExternallyCallable(fn) ? fn.params.map((p) => p.name).filter(Boolean) : []);

    statements.forEach((s, index) => {
      if (s.kind === "close") return;
      const castRe = /\b(u?)int(\d+)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = castRe.exec(s.text)) !== null) {
        const open = m.index + m[0].length - 1;
        const close = findMatching(s.text, open, "(", ")");
        if (close < 0) continue;
        const arg = s.text.slice(open + 1, close).trim();
        if (arg.length === 0 || /^-?[\d_]+$/.test(arg) || /^0x[0-9a-fA-F_]+$/.test(arg) || /^type\s*\(/.test(arg)) continue;
        const target: IntTypeInfo = { signed: m[1] === "", bits: parseInt(m[2], 10) };
        const src = sourceInfo(arg, types);
        const words = wordsIn(arg);
        let confidence: DetectorFinding["confidence"] = "high";
        if (src) {
          if (target.bits >= src.bits) continue; // widening or same width: not a truncation
        } else {
          if (!words.some((w) => VALUE_NAME_RE.test(w))) continue;
          confidence = "low";
        }

        const assigned = assignments.find((a) => a.statementIndex === index)?.lhs;
        const guarded = dominatingGuards(statements, guards, index).some((g) => isRangeBound(g.condition, words));
        if (guarded || hasRoundTrip(statements, index, assigned, arg)) continue;

        const reach = new Set<string>();
        for (const w of words) for (const d of derivedFrom(w, assignments, index)) reach.add(d);
        const fromCaller = [...reach].filter((w) => callerInputs.has(w));
        const later = statements.slice(index, index + 8).map((t) => t.text).join(" ; ");
        const context: string[] = [];
        if (TRANSFER_RE.test(later)) context.push("transfer");
        if (AUTH_RE.test(later)) context.push("authorization");
        if (ACCOUNTING_RE.test(`${s.text} ${assigned ?? ""}`)) context.push("accounting");
        if (/block\.timestamp/.test(arg) || /(timestamp|deadline|expiry)/i.test(assigned ?? "")) context.push("timestamp");
        if (ID_RE.test(`${arg} ${assigned ?? ""}`)) context.push("identifier");

        const high = context.some((c) => c === "transfer" || c === "authorization" || c === "accounting");
        const medium = context.length > 0 || fromCaller.length > 0;
        findings.push({
          ruleId: RULE_ID,
          severity: high && (fromCaller.length > 0 || confidence === "high") ? "high" : medium ? "medium" : "low",
          confidence: fromCaller.length > 0 && confidence === "high" ? "high" : confidence === "low" ? "low" : "medium",
          title: "Narrowing cast may truncate the value",
          message: `\`${m[1]}int${m[2]}(${arg})\` in ${fn.name}() narrows ${src ? `a ${src.signed ? "" : "u"}int${src.bits} value` : "a value of unknown width"} to ${m[1]}int${m[2]} with no dominating range check; values above the target maximum are silently truncated.`,
          line: s.line,
          endLine: s.line,
          functionName: fn.name,
          evidence: [
            s.text,
            src ? `source width ${src.bits} bits, target ${target.bits} bits` : "source width unknown (reported because the operand name looks value-like)",
            ...(fromCaller.length > 0 ? [`operand derives from caller input ${fromCaller.join(", ")}`] : []),
            ...(context.length > 0 ? [`influences: ${context.join(", ")}`] : []),
          ],
          rationale: high
            ? "The truncated value reaches transfers, authorization or accounting, where a wrapped amount changes who gets what."
            : medium
              ? "The value is an identifier, timestamp or caller-influenced input; truncation changes behavior but not directly funds."
              : "No sensitive use was found nearby; severity low.",
          remediation: "Use SafeCast or require(value <= type(uintN).max) before narrowing.",
        });
      }
    });
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
