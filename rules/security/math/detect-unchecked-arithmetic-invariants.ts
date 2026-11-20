/**
 * Unchecked block scope and arithmetic invariants (#1365)
 *
 * Reviews arithmetic inside `unchecked { ... }` blocks. For each addition, subtraction,
 * multiplication, exponentiation, increment or compound assignment it looks for a bound that
 * justifies skipping the overflow check: a dominating `require` / `if (...) revert` that
 * relates the operands, or a loop condition bounding a counter. When none is found the finding
 * names the missing invariant (for example "a >= b before a - b") instead of a generic warning.
 *
 * Supported: Solidity 0.8.x source text (see _shared/solidity-source.ts for shared assumptions).
 */
import {
  Assignment,
  DetectorFinding,
  DetectorResult,
  Guard,
  Statement,
  blockEnd,
  buildResult,
  collectAssignments,
  collectGuards,
  derivedFrom,
  dominatingGuards,
  enclosingOpens,
  extractFunctions,
  failedResult,
  isExternallyCallable,
  isLoopHeader,
  mentionsWord,
  splitStatements,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "arith-unchecked-invariants";

export const LIMITATIONS = [
  "Textual analysis of a single file: guards in modifiers, base contracts or other functions are not seen.",
  "A guard counts as a bound when its condition mentions the operand; the guard's arithmetic is not proven correct.",
  "Value ranges are not tracked: a guard against an unrelated limit can hide a real overflow (false negative).",
  "Explicit casts are not evaluated; a narrowing cast of an unchecked result is reported only as extra evidence.",
];

const SUGGESTION =
  "Prove each unchecked operation with a dominating bound (for example require(a >= b) before a - b), keep unchecked scopes minimal, or remove the unchecked block.";

interface Operation {
  op: "+" | "-" | "*" | "**" | "++" | "--";
  operands: string[];
  text: string;
}

const COMPOUND = /^([A-Za-z_$][\w$.]*(?:\[[^\]]*\])*)\s*(\+|-|\*)=\s*([\s\S]+)$/;
const INCDEC_POST = /^([A-Za-z_$][\w$.]*(?:\[[^\]]*\])*)\s*(\+\+|--)$/;
const INCDEC_PRE = /^(\+\+|--)\s*([A-Za-z_$][\w$.]*(?:\[[^\]]*\])*)$/;
const BINARY = /([A-Za-z_$][\w$.]*(?:\[[^\]]*\])*|\d[\w.]*)\s*(\*\*|\+(?!\+)|-(?!-)|\*(?!\*))\s*([A-Za-z_$][\w$.]*(?:\[[^\]]*\])*|\d[\w.]*|\()/g;

function baseName(operand: string): string {
  return operand.replace(/\[[\s\S]*$/, "").replace(/\..*$/, "");
}

function operationsIn(text: string): Operation[] {
  const ops: Operation[] = [];
  let m = COMPOUND.exec(text);
  if (m) {
    ops.push({ op: m[2] as Operation["op"], operands: [m[1], ...wordsIn(m[3])], text });
    return ops;
  }
  m = INCDEC_POST.exec(text);
  if (m) return [{ op: m[2] as Operation["op"], operands: [m[1]], text }];
  m = INCDEC_PRE.exec(text);
  if (m) return [{ op: m[1] as Operation["op"], operands: [m[2]], text }];
  const rhs = text.replace(/^(?:[A-Za-z_$][\w$]*(?:\[\d*\])?\s+(?:memory\s+|storage\s+)?)?[A-Za-z_$][\w$.]*(?:\[[^\]]*\])*\s*=(?!=)\s*/, "").replace(/^return\s+/, "");
  BINARY.lastIndex = 0;
  let b: RegExpExecArray | null;
  while ((b = BINARY.exec(rhs)) !== null) {
    const left = b[1];
    const right = b[3];
    if (/^\d/.test(left) && /^\d/.test(right)) continue;
    ops.push({ op: b[2] as Operation["op"], operands: [left, right].filter((o) => o !== "("), text });
    BINARY.lastIndex = b.index + b[1].length + b[2].length;
  }
  return ops;
}

const COMPARISON = /(<=|>=|<|>|==|!=)/;

function coversOperation(op: Operation, guards: Guard[], assignments: Assignment[], beforeIndex: number): Guard | undefined {
  const names = op.operands.filter((o) => !/^\d/.test(o)).map(baseName);
  if (names.length === 0) return undefined;
  return guards.find((g) => {
    if (!COMPARISON.test(g.condition) && !/type\s*\(/.test(g.condition)) return false;
    const mentions = (n: string) => {
      const sources = derivedFrom(n, assignments, beforeIndex);
      return [...sources].some((s) => mentionsWord(g.condition, s));
    };
    if (op.op === "-" || op.op === "--") return names.length >= 2 ? names.every(mentions) : names.some(mentions);
    if (op.op === "*" || op.op === "**") return names.every((n) => mentions(n) || /^[A-Z][A-Z0-9_]*$/.test(n));
    return names.some(mentions); // additions and increments need an upper bound on at least one side
  });
}

function loopBoundsCounter(statements: Statement[], index: number, counter: string): boolean {
  return enclosingOpens(statements, index).some((o) => {
    if (!isLoopHeader(o.text)) return false;
    const m = /^for\s*\(([^;]*);([^;]*);/.exec(o.text) ?? /^while\s*\(([\s\S]*)\)/.exec(o.text);
    if (!m) return false;
    const cond = m[2] ?? m[1];
    return mentionsWord(cond, counter) && /(<=|<|>=|>)/.test(cond);
  });
}

export function detectUncheckedArithmeticInvariants(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const seen = new Set<string>();

  for (const fn of extractFunctions(v.clean)) {
    const statements = splitStatements(fn, v.clean);
    const guards = collectGuards(statements);
    const assignments = collectAssignments(statements);
    const callerInputs = new Set(isExternallyCallable(fn) ? fn.params.map((p) => p.name).filter(Boolean) : []);

    statements.forEach((s, i) => {
      if (s.kind !== "open" || s.text !== "unchecked") return;
      const end = blockEnd(statements, i);
      for (let j = i + 1; j < end; j++) {
        const st = statements[j];
        if (st.kind !== "stmt") continue;
        for (const op of operationsIn(st.text)) {
          const names = op.operands.filter((o) => !/^\d/.test(o)).map(baseName);
          if (names.length === 0) continue;
          if ((op.op === "++" || op.op === "--" || /\+=\s*1$/.test(st.text)) && loopBoundsCounter(statements, i, names[0])) continue;
          const guard = coversOperation(op, dominatingGuards(statements, guards, j), assignments, j);
          if (guard) continue;
          const key = `${st.line}:${op.op}:${names.join(",")}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const fromCaller = names.filter((n) => [...derivedFrom(n, assignments, j)].some((d) => callerInputs.has(d)));
          const inLoop = enclosingOpens(statements, j).some((o) => isLoopHeader(o.text));
          const pair = names.length >= 2 ? `${names[0]} ${op.op} ${names[1]}` : names[0];
          const invariant =
            op.op === "-" || op.op === "--"
              ? names.length >= 2 ? `${names[0]} >= ${names[1]}` : `${names[0]} > 0`
              : op.op === "*" || op.op === "**"
                ? `${names.join(" * ")} fits in the result type (bound each operand)`
                : `${names[0]} stays below the type maximum`;
          const castNote = /\b(?:u?int\d*)\s*\([^)]*[-+*]/.test(st.text) ? ["the result is also narrowed by an explicit cast"] : [];
          findings.push({
            ruleId: RULE_ID,
            severity: fromCaller.length > 0 ? "high" : "medium",
            confidence: fromCaller.length > 0 ? "high" : "medium",
            title: "Unchecked arithmetic without a bounding invariant",
            message: `\`${pair}\` (${op.op}) runs in an unchecked block in ${fn.name}() with no dominating check that establishes: ${invariant}.`,
            line: st.line,
            endLine: st.line,
            functionName: fn.name,
            evidence: [
              st.text,
              fromCaller.length > 0 ? `operand(s) ${fromCaller.join(", ")} derive from caller-supplied parameters` : "operands are not derived from caller parameters in this function",
              ...(inLoop ? ["inside a loop: the value accumulates across iterations"] : []),
              ...castNote,
            ],
            rationale:
              fromCaller.length > 0
                ? "Caller-influenced operands let an attacker choose values that wrap silently; severity high."
                : "No caller influence was found in this function, but the missing proof means wrapping depends on contract state; severity medium.",
            remediation: `Add a dominating check for ${invariant}, or move the operation out of the unchecked block.`,
          });
        }
      }
    });
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
