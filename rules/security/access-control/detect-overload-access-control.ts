/**
 * Inconsistent access control across external function overloads (#1308)
 *
 * Groups public and external state-changing functions by name inside one contract. When some
 * overloads are access controlled and others are not, the unprotected overloads are reported.
 * Overloads that forward to another function of the same name are treated as covered by it.
 * When every protected overload uses a different modifier set, the mismatch is reported once.
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  SolidityFunction,
  buildResult,
  extractFunctions,
  failedResult,
  isExternallyCallable,
  validateSource,
} from "../_shared/solidity-source";
import { contractAtIndex, extractContractRanges, modifierNames } from "../_shared/solidity-contracts";

export const RULE_ID = "overload-access-control";

export const LIMITATIONS = [
  "Overloads are grouped by name inside one contract; overloads inherited from other contracts are not compared.",
  "Access control is recognised from auth-style modifiers and caller or role checks; custom schemes may be missed.",
  "An overload that calls another function with the same name is assumed to inherit that function's protection.",
];

const SUGGESTION = "Apply the same access control modifier to every state-changing overload, or route all overloads through one protected function.";

const AUTH_MODIFIER = /^(only|auth|restricted|requires?(Auth|Role)|isOwner|isAdmin|whenAuthorized)/i;
const AUTH_BODY = /\b(_checkOwner|_checkRole|hasRole|isOwner|isAdmin)\s*\(|\b(require|assert)\s*\([^;]*(msg\.sender|_msgSender\s*\(\s*\))|\bif\s*\([^)]*(msg\.sender|_msgSender\s*\(\s*\))[^)]*\)\s*(revert|\{)/;

function signature(f: SolidityFunction): string {
  return `${f.name}(${f.params.map((p) => p.type).join(",")})`;
}

function authModifiers(f: SolidityFunction): string[] {
  return modifierNames(f.header).filter((m) => AUTH_MODIFIER.test(m)).sort();
}

export function detectOverloadAccessControl(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const ranges = extractContractRanges(v.clean);
  const functions = extractFunctions(v.clean).filter(
    (f) => isExternallyCallable(f) && f.mutability !== "view" && f.mutability !== "pure",
  );

  const groups = new Map<string, SolidityFunction[]>();
  for (const f of functions) {
    const owner = contractAtIndex(ranges, f.bodyStart)?.name ?? "";
    const key = `${owner}::${f.name}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  for (const [key, overloads] of groups) {
    if (overloads.length < 2) continue;
    const name = key.split("::")[1];
    const forwards = new RegExp(`\\b${name}\\s*\\(`);
    const direct = overloads.filter((f) => !forwards.test(f.body));
    const isProtected = (f: SolidityFunction) => authModifiers(f).length > 0 || AUTH_BODY.test(f.body);
    const guarded = direct.filter(isProtected);
    const open = direct.filter((f) => !isProtected(f));

    if (guarded.length > 0 && open.length > 0) {
      for (const f of open) {
        findings.push({
          ruleId: RULE_ID,
          severity: "high",
          confidence: "medium",
          title: "Overload without access control",
          message: `${signature(f)} is not access controlled while overload ${guarded.map(signature).join(", ")} is`,
          line: f.startLine,
          endLine: f.endLine,
          functionName: f.name,
          evidence: [`protected: ${guarded.map((g) => `${signature(g)} (line ${g.startLine})`).join("; ")}`],
          rationale: "Callers can pick the unprotected overload to reach the same privileged behaviour.",
          remediation: "Add the same modifier to this overload or forward it to the protected one.",
        });
      }
    }

    const sets = new Set(guarded.map((f) => authModifiers(f).join("|")).filter(Boolean));
    if (sets.size > 1) {
      const first = guarded[1];
      findings.push({
        ruleId: RULE_ID,
        severity: "medium",
        confidence: "low",
        title: "Overloads use different access modifiers",
        message: `Overloads of ${name} are guarded by different modifiers: ${Array.from(sets).join(", ")}`,
        line: first.startLine,
        endLine: first.endLine,
        functionName: name,
        evidence: guarded.map((g) => `${signature(g)}: ${authModifiers(g).join(", ") || "inline check"}`),
        rationale: "Different roles may be able to call what is meant to be one privileged operation.",
        remediation: "Use one role for all overloads of the same operation.",
      });
    }
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
