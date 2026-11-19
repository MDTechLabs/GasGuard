/**
 * Division-by-zero paths in configurable financial parameters (#1369)
 *
 * Finds `/`, `%`, `/=` and Yul `div`/`mod` whose divisor can be zero and has no non-zero guard.
 * Divisor sources considered: caller-supplied parameters, mutable state set by setters, oracle or
 * pool state (total supply, reserves), and deployment-time configuration. Findings name the
 * reachable path (for example "setFeeDenominator() can set it to zero") and the missing guard.
 *
 * Revert-on-zero versus silent failure:
 *  - Solidity 0.8 checked division reverts with Panic(0x12). With no guard that is an implicit
 *    revert: reported as a denial-of-service risk, severity by reachability.
 *  - Yul `div`/`mod` return 0 for a zero divisor: a silently wrong result, reported high.
 *  - `if (x == 0) return 0;` is deliberate but silent: reported low as a silent zero result.
 *  - A dominating `require(x != 0)` / `if (x == 0) revert` is deliberate revert-on-zero: no finding.
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  Guard,
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
  isExternallyCallable,
  makeLineIndex,
  splitStatements,
  splitTopLevel,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "arith-division-by-zero";

export const LIMITATIONS = [
  "Divisors are matched by their source text; a guard on a differently named alias of the same value is not recognised.",
  "Setter analysis is by function name and assignment in this file; inherited setters and proxies are not followed.",
  "Access control is judged from modifier names (only*, auth*, requiresAuth); custom schemes are treated as unrestricted.",
  "Value ranges are not tracked: a divisor that is non-zero by construction (for example `n + 1`) is recognised only for the `+ 1` and max(x, 1) idioms.",
];

const SUGGESTION =
  "Validate every divisor before dividing (require(d != 0, \"zero divisor\")), validate it in the setter that configures it, and handle the empty-pool case explicitly.";

const CLASS_RULES: Array<[RegExp, string]> = [
  [/(fee|denominator|bps|basis)/i, "fee denominator"],
  [/(supply|shares?)/i, "share supply"],
  [/(reserve|liquidity|pool|totalAssets|total)/i, "reserve / pool value"],
  [/(decimal|scale|precision|unit)/i, "decimal scale"],
  [/(price|rate|oracle|answer)/i, "oracle / rate value"],
];

function classify(words: string[]): string {
  for (const [re, label] of CLASS_RULES) if (words.some((w) => re.test(w))) return label;
  return "financial parameter";
}

function esc(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
}

export function provesNonZero(guard: Guard, expr: string): boolean {
  const e = esc(expr.trim());
  const cond = guard.condition;
  if (guard.form === "require") {
    return new RegExp(`${e}\\s*(?:>|!=)\\s*0\\b|${e}\\s*>=\\s*1\\b|\\b0\\s*(?:<|!=)\\s*${e}|\\b1\\s*<=\\s*${e}`).test(cond);
  }
  return new RegExp(`${e}\\s*(?:==|<=|<)\\s*[01]\\b|\\b[01]\\s*(?:==|>=|>)\\s*${e}`).test(cond);
}

function divisorsIn(text: string): Array<{ divisor: string; index: number }> {
  const out: Array<{ divisor: string; index: number }> = [];
  const re = /(?<![/*])([/%])(?![/*])(=?)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const i = m.index + m[0].length;
    if (text[i] === "(") {
      const close = findMatching(text, i, "(", ")");
      if (close > 0) out.push({ divisor: text.slice(i + 1, close).trim(), index: m.index });
      continue;
    }
    const rest = text.slice(i);
    const op = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*\([^()]*\))?(?:\s*\[[^\]]*\])*|^\d[\w.]*/.exec(rest);
    if (op) out.push({ divisor: op[0].trim(), index: m.index });
  }
  return out;
}

function isNonZeroByConstruction(divisor: string, constants: Map<string, string>): boolean {
  const d = divisor.trim();
  if (/^0[xX][0-9a-fA-F_]*[1-9a-fA-F][0-9a-fA-F_]*$/.test(d) || /^(?:[1-9][\d_]*|\d+[eE]\d+|\d+\s*\*\*\s*\d+)$/.test(d)) return true;
  if (/^10\s*\*\*\s*\d+$/.test(d)) return true;
  const c = constants.get(d);
  if (c !== undefined) return /[1-9]/.test(c) && !/^\s*0\s*$/.test(c);
  if (/\+\s*1\b|\b1\s*\+/.test(d)) return true;
  if (/\bmax\s*\([^)]*,\s*1\s*\)|\bmax\s*\(\s*1\s*,/.test(d)) return true;
  return false;
}

interface SetterInfo {
  fn: string;
  guarded: boolean;
  restricted: boolean;
}

export function detectDivisionByZeroPaths(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const functions = extractFunctions(v.clean);
  // Declarations outside function bodies only, so locals are not mistaken for state variables.
  const outsideChars = v.clean.split("");
  for (const fn of functions) for (let k = fn.bodyStart; k < fn.bodyStart + fn.body.length; k++) if (outsideChars[k] !== "\n") outsideChars[k] = " ";
  const outside = outsideChars.join("");
  const stateTypes = collectStateTypes(outside);
  const lineOf = makeLineIndex(v.clean);

  const constants = new Map<string, string>();
  const constRe = /\b[\w$]+(?:\s+(?:public|private|internal))?\s+constant\s+(?:(?:public|private|internal)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
  let cm: RegExpExecArray | null;
  while ((cm = constRe.exec(outside)) !== null) constants.set(cm[1], cm[2].trim());
  const declInit = new Map<string, string>();
  const initRe = /(?<=^|[;{}])\s*(?:u?int\d*|address|bool)\s+(?:(?:public|private|internal|immutable)\s+)*([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
  let im: RegExpExecArray | null;
  while ((im = initRe.exec(outside)) !== null) declInit.set(im[1], im[2].trim());

  const prepared = functions.map((fn) => {
    const statements = splitStatements(fn, v.clean);
    return { fn, statements, assignments: collectAssignments(statements), guards: collectGuards(statements) };
  });

  const setters = new Map<string, SetterInfo[]>();
  const ctorAssigned = new Set<string>();
  for (const p of prepared) {
    for (const a of p.assignments) {
      if (!stateTypes.has(a.lhs) && !declInit.has(a.lhs)) continue;
      if (p.fn.kind === "constructor") {
        ctorAssigned.add(a.lhs);
        continue;
      }
      if (!isExternallyCallable(p.fn) || a.compound) continue;
      const rhsWords = wordsIn(a.rhs);
      const guarded = p.guards.some((g) => rhsWords.some((w) => provesNonZero(g, w)) || provesNonZero(g, a.rhs));
      const list = setters.get(a.lhs) ?? [];
      list.push({ fn: p.fn.name, guarded, restricted: /\b(only\w*|auth\w*|requiresAuth|whenNotPaused)\b/.test(p.fn.header) });
      setters.set(a.lhs, list);
    }
  }

  for (const p of prepared) {
    const { fn, statements, assignments, guards } = p;
    const types = collectLocalTypes(fn, statements);
    const callerParams = new Set(isExternallyCallable(fn) ? fn.params.map((x) => x.name).filter(Boolean) : []);

    const report = (stmt: Statement, divisor: string, silent: boolean, yul: boolean, index: number) => {
      const words = wordsIn(divisor);
      const reach = new Set<string>();
      for (const w of words) for (const d of derivedFrom(w, assignments, index)) reach.add(d);
      const all = [...reach];
      const klass = classify(all);
      const paths: string[] = [];
      let severity: DetectorFinding["severity"] = "low";
      const fromCaller = all.filter((w) => callerParams.has(w) && types.has(w));
      if (fromCaller.length > 0) {
        paths.push(`the caller supplies ${fromCaller.join(", ")} and can pass zero`);
        severity = "high";
      }
      for (const w of all) {
        if (!stateTypes.has(w) && !declInit.has(w)) continue;
        const list = (setters.get(w) ?? []).filter((s) => !s.guarded);
        for (const s of list) {
          paths.push(`${s.fn}() can set ${w} to zero (no non-zero check${s.restricted ? "; restricted to a privileged caller" : "; callable without access modifier"})`);
          if (!s.restricted) severity = "high";
          else if (severity !== "high") severity = "medium";
        }
        if (list.length === 0 && !declInit.has(w) && !ctorAssigned.has(w) && !constants.has(w) && !/^[A-Z][A-Z0-9_]*$/.test(w)) {
          paths.push(/(supply|reserve|liquidity|pool|total)/i.test(w) ? `${w} is zero before the first deposit and after a full withdrawal` : `${w} defaults to zero until it is initialized`);
          if (severity === "low") severity = "medium";
        }
      }
      if (/(supply|reserve|liquidity|pool|totalAssets|balanceOf)/i.test(all.join(" ") + divisor) && paths.length === 0) {
        paths.push("pool state is zero before the first deposit and after a full withdrawal");
        severity = "medium";
      }
      if (/(latestAnswer|latestRoundData|getPrice|\bprice\b|\banswer\b)/i.test(divisor + " " + all.join(" "))) {
        paths.push("an oracle can report zero");
        if (severity === "low") severity = "medium";
      }
      if (yul) severity = "high";
      if (silent) severity = "low";
      if (paths.length === 0 && !yul && !silent) {
        // State variables with guarded setters are fine. For other values of unknown origin,
        // report only when the name looks financial.
        const touchesState = all.some((w) => stateTypes.has(w) || declInit.has(w));
        if (touchesState || klass === "financial parameter") return;
        paths.push("the value is not validated in this function");
      }
      const missing = `require(${divisor} != 0)`;
      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence: fromCaller.length > 0 || yul ? "high" : "medium",
        title: yul ? "Yul division silently returns 0 for a zero divisor" : silent ? "Zero divisor handled by a silent zero result" : "Divisor can be zero without a guard",
        message: yul
          ? `Yul division by \`${divisor}\` in ${fn.name}() returns 0 instead of reverting when the divisor is zero; the result is silently wrong. Missing guard: ${missing}.`
          : silent
            ? `\`${divisor}\` is checked for zero in ${fn.name}() but the function returns 0 silently; callers may treat 0 as a valid ${klass} result.`
            : `Division by \`${divisor}\` (${klass}) in ${fn.name}() has no dominating non-zero check, so a zero divisor reverts with Panic(0x12): ${paths.join("; ")}. Missing guard: ${missing}.`,
        line: stmt.line,
        endLine: stmt.line,
        functionName: fn.name,
        evidence: [stmt.text, ...paths],
        rationale: yul
          ? "Yul div/mod do not revert on zero, so the wrong value is used silently."
          : silent
            ? "The zero case is deliberate but silent."
            : severity === "high"
              ? "The zero value is reachable by a caller or by an unrestricted setter, so the function can be made to revert."
              : "The zero value is reachable through privileged configuration or empty pool state.",
        remediation: yul || !silent ? `Add ${missing} (or an explicit revert) before dividing, and validate the value where it is configured.` : "Revert on zero instead of returning 0, or document the sentinel.",
      });
    };

    statements.forEach((s, index) => {
      if (s.kind === "close") return;
      const dominating = dominatingGuards(statements, guards, index);
      const isAssemblyBlock = /^assembly\b/.test(s.text);
      if (isAssemblyBlock) return;
      for (const d of divisorsIn(s.text)) {
        if (isNonZeroByConstruction(d.divisor, constants)) continue;
        if (/^\d/.test(d.divisor)) continue;
        const guard = dominating.find((g) => provesNonZero(g, d.divisor));
        if (guard) {
          const text = statements[guard.index].text + " " + (statements[guard.index + 1]?.text ?? "");
          if (guard.form === "return-if" && /return\s+0\b/.test(text)) report(s, d.divisor, true, false, index);
          continue;
        }
        report(s, d.divisor, false, false, index);
      }
    });

    // Yul blocks: scan the raw function body because assembly statements are not ';'-separated.
    const asmRe = /\bassembly\s*(?:\([^)]*\))?\s*\{/g;
    let am: RegExpExecArray | null;
    while ((am = asmRe.exec(fn.body)) !== null) {
      const open = am.index + am[0].length - 1;
      const close = findMatching(fn.body, open);
      if (close < 0) continue;
      const block = fn.body.slice(open, close + 1);
      const callRe = /\b(div|sdiv|mod|smod)\s*\(/g;
      let c: RegExpExecArray | null;
      while ((c = callRe.exec(block)) !== null) {
        const openParen = c.index + c[0].length - 1;
        const closeParen = findMatching(block, openParen, "(", ")");
        if (closeParen < 0) continue;
        const args = splitTopLevel(block.slice(openParen + 1, closeParen));
        const divisor = (args[1] ?? "").trim();
        if (!divisor || isNonZeroByConstruction(divisor, constants)) continue;
        if (new RegExp(`iszero\\s*\\(\\s*${esc(divisor)}\\s*\\)|eq\\s*\\(\\s*${esc(divisor)}\\s*,\\s*0\\s*\\)`).test(block)) continue;
        const absolute = fn.bodyStart + am.index;
        const pre = statements.findIndex((st) => st.start > absolute);
        const index = pre < 0 ? statements.length : pre;
        if (guards.some((g) => statements[g.index].start < absolute && provesNonZero(g, divisor))) continue;
        const stmt: Statement = { text: `assembly { ... ${c[1]}(${args.map((a) => a.trim()).join(", ")}) ... }`, start: absolute, line: lineOf(absolute), kind: "stmt", blockPath: [] };
        report(stmt, divisor, false, true, index);
      }
    }
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
