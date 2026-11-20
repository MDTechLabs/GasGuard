/**
 * Precision loss in chained fixed-point calculations (#1366)
 *
 * Finds expressions where an integer division is evaluated before a multiplication (or twice in
 * a row), so the truncated remainder is amplified or compounded. Prioritises share pricing,
 * fees, collateral ratios and exchange rates. A finding states where truncation happens and, only
 * when one exists, the reachable value-impact path (returned to callers, stored in state, or
 * passed to a transfer/mint/burn). Without such a path the finding is low severity and worded
 * as a possibility, not an exploit.
 *
 * Supported: Solidity 0.8.x source text; common scales WAD/RAY/1e18/1e27/BPS/10000 are tracked by name.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  collectAssignments,
  collectStateTypes,
  extractFunctions,
  failedResult,
  isExternallyCallable,
  mentionsWord,
  splitStatements,
  splitTopLevel,
  validateSource,
} from "../_shared/solidity-source";

export const RULE_ID = "arith-fixed-point-precision-loss";

export const LIMITATIONS = [
  "Operator precedence is modelled for + - * / ** and parentheses only; bit shifts and assembly are ignored.",
  "Operand magnitudes are unknown, so the size of the loss is not quantified; only the operation order is judged.",
  "Library helpers such as mulDiv are treated as safe; their internals are not inspected.",
  "Intentional division-first orderings (to avoid overflow) are flagged; review them against the documented precision policy.",
];

const SUGGESTION =
  "Multiply before dividing (or use mulDiv) so truncation happens once, at the end, with the rounding direction your accounting policy requires.";

const SCALE_RE = /\b(?:1e\d+|10\s*\*\*\s*\d+|WAD|RAY|PRECISION|SCALE|BPS|BASIS_POINTS|DENOMINATOR|FEE_DENOMINATOR|10{3,})\b/g;
const VALUE_RE = /(share|price|fee|collateral|ratio|rate|exchange|asset|reserve|borrow|interest|reward|debt|liquidat|supply|convert)/i;
const SINK_RE = /\b(?:safeTransfer|safeTransferFrom|transfer|transferFrom|send|mint|burn|_mint|_burn)\s*\(|\+=|-=|balances?\s*\[|totalSupply|shares\s*\[/;

type Token = { kind: "operand"; text: string } | { kind: "op"; op: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let buf = "";
  const flush = () => {
    if (buf.trim().length > 0) tokens.push({ kind: "operand", text: buf.trim() });
    buf = "";
  };
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && (ch === "*" || ch === "/" || ch === "+" || ch === "-")) {
      const binary = buf.trim().length > 0 && !/[*/+\-(<>=!&|^%]$/.test(buf.trim());
      if (ch === "*" && expr[i + 1] === "*" && binary) {
        flush();
        tokens.push({ kind: "op", op: "**" });
        i++;
        continue;
      }
      if (binary) {
        flush();
        tokens.push({ kind: "op", op: ch });
        continue;
      }
    }
    buf += ch;
  }
  flush();
  return tokens;
}

function stripParens(text: string): string {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0 && i < t.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (!wrapsAll) break;
    t = t.slice(1, -1).trim();
  }
  return t;
}

function endsWithDivision(group: string): boolean {
  const inner = stripParens(group);
  const toks = tokenize(inner);
  let lastOp = "";
  for (const t of toks) if (t.kind === "op" && (t.op === "*" || t.op === "/" || t.op === "+" || t.op === "-")) lastOp = t.op;
  return group.trim().startsWith("(") && inner !== group.trim() && lastOp === "/";
}

export interface ChainIssue {
  kind: "division-before-multiplication" | "chained-division";
  expression: string;
}

/** Finds precision-losing operation orders inside one expression, recursing into groups and call arguments. */
export function analyzeExpression(expr: string, out: ChainIssue[] = []): ChainIssue[] {
  const tokens = tokenize(stripParens(expr));
  // Recurse into groups and call arguments first.
  for (const t of tokens) {
    if (t.kind !== "operand" || !t.text.includes("(")) continue;
    const text = t.text;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "(") continue;
      let depth = 0;
      let j = i;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      for (const arg of splitTopLevel(text.slice(i + 1, j))) analyzeExpression(arg, out);
      i = j;
    }
  }
  // Split into additive terms and inspect each multiplicative chain.
  const terms: Token[][] = [[]];
  for (const t of tokens) {
    if (t.kind === "op" && (t.op === "+" || t.op === "-")) terms.push([]);
    else terms[terms.length - 1].push(t);
  }
  for (const term of terms) {
    const operands = term.filter((t): t is { kind: "operand"; text: string } => t.kind === "operand").map((t) => t.text);
    const ops = term.filter((t): t is { kind: "op"; op: string } => t.kind === "op").map((t) => t.op);
    if (ops.length === 0 && operands.length === 1 && !endsWithDivision(operands[0])) continue;
    const text = term.map((t) => (t.kind === "operand" ? t.text : t.op)).join(" ");
    let divSeen = false;
    let flagged = false;
    for (const op of ops) {
      if (op === "/" && divSeen && !flagged) {
        out.push({ kind: "chained-division", expression: text });
        flagged = true;
      }
      if (op === "*" && divSeen && !flagged) {
        out.push({ kind: "division-before-multiplication", expression: text });
        flagged = true;
      }
      if (op === "/") divSeen = true;
    }
    if (!flagged) {
      operands.forEach((operand, k) => {
        if (flagged || !endsWithDivision(operand)) return;
        const before = ops[k - 1];
        const after = ops[k];
        if (before === "*" || after === "*") {
          out.push({ kind: "division-before-multiplication", expression: text });
          flagged = true;
        }
      });
    }
  }
  return out;
}

function expressionOf(statement: string): string {
  return statement
    .replace(/^return\s+/, "")
    .replace(/^(?:[A-Za-z_$][\w$]*(?:\[\d*\])?\s+(?:memory\s+|storage\s+)?)?[A-Za-z_$][\w$.]*(?:\[[^\]]*\])*\s*(?:[-+*/]?=)(?!=)\s*/, "");
}

export function detectFixedPointPrecisionLoss(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const stateTypes = collectStateTypes(v.clean);

  for (const fn of extractFunctions(v.clean)) {
    const statements = splitStatements(fn, v.clean);
    const assignments = collectAssignments(statements);
    statements.forEach((s, index) => {
      if (s.kind !== "stmt" || !s.text.includes("/")) return;
      if (/^emit\b/.test(s.text)) return;
      const issues = analyzeExpression(expressionOf(s.text));
      if (issues.length === 0) return;
      const issue = issues[0];
      const assigned = assignments.find((a) => a.statementIndex === index);
      const scales = Array.from(new Set(s.text.match(SCALE_RE) ?? []));
      const isReturn = /^return\b/.test(s.text);
      const paths: string[] = [];
      if (isReturn && isExternallyCallable(fn)) paths.push(`returned by public/external ${fn.name}()`);
      if (assigned && (stateTypes.has(assigned.lhs) || assigned.lhs.includes("."))) paths.push(`stored in state variable ${assigned.lhs}`);
      if (assigned) {
        const later = statements.slice(index + 1).find((t) => t.kind === "stmt" && mentionsWord(t.text, assigned.lhs) && SINK_RE.test(t.text));
        if (later) paths.push(`${assigned.lhs} reaches \`${later.text.slice(0, 60)}\``);
      }
      if (SINK_RE.test(s.text)) paths.push("used directly in a transfer, mint, burn or balance update");
      const valueContext = VALUE_RE.test(fn.name) || VALUE_RE.test(s.text) || scales.length > 0;
      const reachable = paths.length > 0;
      const detail =
        issue.kind === "division-before-multiplication"
          ? "integer division truncates before a later multiplication, which scales the lost remainder up"
          : "two integer divisions in a row truncate twice";
      findings.push({
        ruleId: RULE_ID,
        severity: reachable && valueContext ? "medium" : "low",
        confidence: reachable ? "medium" : "low",
        title: "Precision loss in chained fixed-point arithmetic",
        message: `In ${fn.name}(), \`${issue.expression}\`: ${detail}. ${
          reachable ? `Value-impact path: ${paths[0]}.` : "No reachable value-impact path was found, so this may be harmless."
        }`,
        line: s.line,
        endLine: s.line,
        functionName: fn.name,
        evidence: [s.text, ...(scales.length ? [`fixed-point scale(s): ${scales.join(", ")}`] : []), "division rounds toward zero (floor for unsigned values)", ...paths],
        rationale: reachable
          ? "The truncated value flows to a place that affects balances or caller-visible results; severity medium for value-related code, low otherwise."
          : "Without a value-impact path the loss is only an accuracy concern; severity low.",
        remediation: "Reorder to multiply first, e.g. (a * b) / c, or use mulDiv; round in the direction that favors the protocol and document it.",
      });
    });
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
