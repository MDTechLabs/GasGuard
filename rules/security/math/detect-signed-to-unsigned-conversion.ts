/**
 * Unsafe signed-to-unsigned conversions (#1367)
 *
 * Finds `uintN(x)` casts whose operand is signed. A negative `x` is reinterpreted as a huge
 * unsigned number (for `int256 -> uint256`, -1 becomes 2^256 - 1), which can corrupt balances,
 * fees, limits and accounting. The detector:
 *  - follows signed values from external-function parameters, signed arithmetic results,
 *    oracle answers and state variables into the cast,
 *  - accepts a dominating guard that proves the value is non-negative (`require(x >= 0)`,
 *    `if (x < 0) revert`), an explicit `abs`/ternary normalisation, or SafeCast,
 *  - reports narrow casts (`uint8(int256)`) and wide ones (`uint256(int128)`) separately.
 *
 * Supported: Solidity 0.8.x source text. Type information comes from declarations in the same file.
 */
import {
  DetectorFinding,
  DetectorResult,
  Guard,
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
  splitStatements,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "arith-signed-to-unsigned";

export const LIMITATIONS = [
  "Signedness comes from declarations in this file; inherited or imported variables of unknown type are not recognised.",
  "Values returned by user-defined functions are signed only when the function's `returns (intN ...)` is declared in this file.",
  "A guard counts when it compares the cast operand with zero; range proofs through other variables are not followed.",
  "Oracle answers named `answer` or read through latestAnswer()/latestRoundData() are treated as signed (heuristic, medium confidence).",
];

const SUGGESTION =
  "Use SafeCast.toUint256(x) (reverts on negative input) or require(x >= 0) immediately before the cast.";

const SINK_NAME_RE = /(balance|fee|limit|amount|supply|reserve|debt|price|share|collateral|cap|rate)/i;
const SINK_CALL_RE = /\b(?:safeTransfer|transfer|transferFrom|send|mint|burn|_mint|_burn)\s*\(/;

function isSignedType(type: string | undefined): boolean {
  if (!type) return false;
  const info = intTypeInfo(type.replace(/\[\d*\]$/, ""));
  return info !== null && info.signed;
}

function escape(name: string): string {
  return name.replace(/[$]/g, "\\$");
}

/** True when the guard proves `name` (or the expression `expr`) is >= 0 on the continuing path. */
export function provesNonNegative(guard: Guard, expr: string): boolean {
  const cond = guard.condition.replace(/\s+/g, " ");
  const e = escape(expr.replace(/\s+/g, " ").trim());
  if (guard.form === "require") {
    return new RegExp(`${e}\\s*(?:>=|>)\\s*(?:0|int\\d*\\(0\\))\\b|\\b0\\s*(?:<=|<)\\s*${e}`).test(cond);
  }
  return new RegExp(`${e}\\s*(?:<|<=)\\s*(?:0|int\\d*\\(0\\))\\b|\\b0\\s*(?:>|>=)\\s*${e}`).test(cond);
}

export function detectSignedToUnsignedConversion(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const stateTypes = collectStateTypes(v.clean);
  const functions = extractFunctions(v.clean);
  const signedReturners = new Set<string>();
  for (const fn of functions) {
    const ret = /returns\s*\(\s*(int\d*)\b/.exec(fn.header);
    if (ret) signedReturners.add(fn.name);
  }

  for (const fn of functions) {
    const statements = splitStatements(fn, v.clean);
    const assignments = collectAssignments(statements);
    const guards = collectGuards(statements);
    const types = new Map([...stateTypes, ...collectLocalTypes(fn, statements)]);
    for (const s of statements) {
      if (s.kind === "stmt" && s.text.startsWith("(")) {
        const tupleRe = /\b(u?int\d*)\s+(?:memory\s+)?([A-Za-z_$][\w$]*)/g;
        let t: RegExpExecArray | null;
        while ((t = tupleRe.exec(s.text.split("=")[0])) !== null) types.set(t[2], t[1]);
      }
    }
    const callerSigned = new Set(
      isExternallyCallable(fn) ? fn.params.filter((p) => p.name && isSignedType(p.type)).map((p) => p.name) : [],
    );

    statements.forEach((s, index) => {
      if (s.kind === "close") return;
      const castRe = /\buint(\d*)\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = castRe.exec(s.text)) !== null) {
        const open = m.index + m[0].length - 1;
        const close = findMatching(s.text, open, "(", ")");
        if (close < 0) continue;
        const arg = s.text.slice(open + 1, close).trim();
        if (arg.length === 0 || /^[\d_xXa-fA-F]+$/.test(arg) || /^-?\d/.test(arg)) continue;
        const targetBits = m[1] ? parseInt(m[1], 10) : 256;

        const argWords = wordsIn(arg);
        const reach = new Set<string>();
        for (const w of argWords) for (const d of derivedFrom(w, assignments, index)) reach.add(d);
        const signedVars = [...reach].filter((w) => isSignedType(types.get(w)));
        const signedCast = /\bint\d*\s*\(/.test(arg);
        const signedCall = argWords.some((w) => signedReturners.has(w)) && /\(/.test(arg);
        const oracle = /latestAnswer\s*\(|latestRoundData\s*\(/.test(arg) || argWords.includes("answer");
        if (signedVars.length === 0 && !signedCast && !signedCall && !oracle) continue;
        if (/\babs\s*\(|\?\s*[^:]*:/.test(arg) || /\.abs\s*\(/.test(arg)) continue; // explicit normalisation

        const direct = argWords.length === 1 && /^[A-Za-z_$][\w$]*$/.test(arg);
        const subject = direct ? arg : arg.replace(/\s+/g, " ");
        const guarded = dominatingGuards(statements, guards, index).find((g) => provesNonNegative(g, subject) || signedVars.some((sv) => provesNonNegative(g, sv)));
        if (guarded) continue;

        const fromCaller = signedVars.filter((sv) => callerSigned.has(sv));
        const origins: string[] = [];
        if (fromCaller.length > 0) origins.push(`external input ${fromCaller.join(", ")}`);
        if (signedVars.some((sv) => assignments.some((a) => a.lhs === sv && /[-+*]/.test(a.rhs.replace(/^-/, ""))))) origins.push("signed arithmetic result");
        if (signedCall) origins.push("return value of a function declared to return a signed integer");
        if (oracle) origins.push("oracle answer (latestAnswer/latestRoundData answers are int256)");
        if (signedVars.some((sv) => stateTypes.has(sv)) && origins.length === 0) origins.push("signed state variable");
        if (origins.length === 0) origins.push("signed value");

        const sourceInfo = direct ? intTypeInfo(types.get(arg) ?? "") : null;
        const narrowing = sourceInfo !== null && targetBits < sourceInfo.bits;
        const sink = SINK_NAME_RE.test(s.text) || SINK_CALL_RE.test(s.text) || SINK_NAME_RE.test(fn.name);
        const known = signedVars.length > 0 || signedCast || signedCall;
        findings.push({
          ruleId: RULE_ID,
          severity: fromCaller.length > 0 || sink ? "high" : "medium",
          confidence: known && !oracle ? "high" : "medium",
          title: "Signed value cast to an unsigned type without a non-negative guard",
          message: `\`uint${m[1]}(${arg})\` in ${fn.name}() can turn a negative value into a very large unsigned number${narrowing ? " and also truncates (target is narrower than the source)" : ""}. No dominating check proves ${subject} >= 0.`,
          line: s.line,
          endLine: s.line,
          functionName: fn.name,
          evidence: [s.text, `origin: ${origins.join("; ")}`, `target width: ${targetBits} bits`, ...(sink ? ["the result is used in balance, fee, limit or transfer logic"] : [])],
          rationale:
            fromCaller.length > 0
              ? "A caller can pass a negative number directly; severity high."
              : sink
                ? "The converted value feeds accounting or transfer logic; severity high."
                : "The negative case depends on contract state; severity medium.",
          remediation: "Use SafeCast.toUint256(value) or add require(value >= 0) before the cast; for narrowing casts also bound the value.",
        });
      }
    });
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
