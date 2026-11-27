/**
 * Unchecked custom-error and revert paths (#1299)
 *
 * Flags externally reachable assertions over caller-controlled values and
 * empty try/catch handlers that silently accept a failed external operation.
 *
 * Supported: Solidity 0.8.x source text, single file. This is lexical analysis,
 * not compiler AST analysis; cross-function effects are not resolved.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  extractFunctions,
  failedResult,
  findMatching,
  isExternallyCallable,
  makeLineIndex,
  validateSource,
} from "../_shared/solidity-source";

export const RULE_ID = "unchecked-revert-paths";

export const LIMITATIONS = [
  "Supports Solidity 0.8.x source text; compiler versions, ASTs, IR and compiler settings are not consulted.",
  "Assertions are flagged only when a public/external function directly references a named parameter or caller-controlled global.",
  "Only empty catches and catches containing only event emissions are reported; intentional fallback behavior is not inferred.",
  "Custom error declarations, imported helpers, and cross-function control flow are not resolved.",
  "Custom errors require Solidity 0.8.4 or newer; no repository code or build hooks are executed.",
];

const SUGGESTION =
  "Use custom errors for caller-input validation, reserve assert for internal invariants, and explicitly handle or propagate caught external-call failures.";

function escaped(value: string): string {
  return value.replace(/[$]/g, "\\$");
}

function referencesExternalInput(condition: string, names: string[]): boolean {
  if (/\b(?:msg\.(?:sender|value|data)|tx\.origin)\b/.test(condition)) return true;
  return names.some((name) => new RegExp(`(^|[^\\w$.])${escaped(name)}(?![\\w$])`).test(condition));
}

function isLoggingOnly(body: string): boolean {
  const statements = body.trim();
  return statements.length === 0 || /^(?:emit\s+[A-Za-z_$][\w$]*\s*\([^;]*\)\s*;?\s*)+$/.test(statements);
}

export function detectUncheckedRevertPaths(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);

  const findings: DetectorFinding[] = [];
  const lineOf = makeLineIndex(v.clean);
  const add = (finding: Omit<DetectorFinding, "ruleId" | "endLine">) =>
    findings.push({ ruleId: RULE_ID, endLine: finding.line, ...finding });

  for (const fn of extractFunctions(v.clean)) {
    if (!isExternallyCallable(fn)) continue;

    const parameterNames = fn.params.map((parameter) => parameter.name).filter(Boolean);
    const assertRe = /\bassert\s*\(/g;
    let assertMatch: RegExpExecArray | null;
    while ((assertMatch = assertRe.exec(fn.body)) !== null) {
      const open = fn.body.indexOf("(", assertMatch.index);
      const close = findMatching(fn.body, open, "(", ")");
      if (close < 0) continue;
      const condition = fn.body.slice(open + 1, close);
      if (!referencesExternalInput(condition, parameterNames)) continue;

      const offset = fn.bodyStart + assertMatch.index;
      add({
        severity: "medium",
        confidence: "medium",
        title: "assert used for caller-controlled input",
        message: `${fn.name}() uses assert on caller-controlled input; invalid user input triggers an invariant panic instead of an explicit validation error`,
        line: lineOf(offset),
        functionName: fn.name,
        evidence: [`assert(${condition.trim()})`, "condition references a function parameter or caller-controlled global"],
        rationale: "Assertions represent internal invariants; caller-controlled validation should fail explicitly and should not rely on an invariant panic.",
        remediation: "Use an explicit condition with a custom error (Solidity 0.8.4+) or a require/revert reason on older compiler versions.",
      });
    }

    const catchRe = /\bcatch\b\s*(?:(?:Error|Panic)\s*\([^)]*\)|\([^)]*\))?\s*\{/g;
    let catchMatch: RegExpExecArray | null;
    while ((catchMatch = catchRe.exec(v.clean)) !== null) {
      if (catchMatch.index < fn.bodyStart || catchMatch.index >= fn.bodyStart + fn.body.length) continue;
      const open = v.clean.indexOf("{", catchMatch.index + catchMatch[0].lastIndexOf("catch"));
      const close = findMatching(v.clean, open, "{", "}");
      if (close < 0 || !isLoggingOnly(v.clean.slice(open + 1, close))) continue;

      const body = v.clean.slice(open + 1, close);
      add({
        severity: body.trim() ? "low" : "medium",
        confidence: body.trim() ? "low" : "high",
        title: "Caught external revert is silently accepted",
        message: `${fn.name}() catches an external-call failure without reverting or returning an explicit failure result`,
        line: lineOf(catchMatch.index),
        functionName: fn.name,
        evidence: [body.trim() ? "catch body only emits events" : "catch body is empty"],
        rationale: "The external operation may have failed while the caller continues as though it succeeded, leaving state or downstream assumptions inconsistent.",
        remediation: "Propagate the failure (including revert data where appropriate), return an explicit failure result, or implement a documented recovery path.",
      });
    }
  }

  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
