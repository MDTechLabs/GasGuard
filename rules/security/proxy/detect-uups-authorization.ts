/**
 * UUPS authorization and proxiable UUID checks (#1311)
 *
 * For every non-abstract contract that inherits UUPSUpgradeable, reports:
 *  - no `_authorizeUpgrade` implementation anywhere in the inheritance chain,
 *  - an `_authorizeUpgrade` with no access control (empty body, no auth modifier, no caller check),
 *  - a `proxiableUUID` that does not return the EIP-1967 implementation slot.
 *
 * Supported: Solidity 0.8.x source text, single file. Parents defined in other files are not
 * resolved, so a missing `_authorizeUpgrade` is only reported when every base in the chain is
 * visible in this file or is UUPSUpgradeable itself.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  extractFunctions,
  failedResult,
  makeLineIndex,
  validateSource,
} from "../_shared/solidity-source";
import { contractAtIndex, extractContractRanges, linearize, modifierNames } from "../_shared/solidity-contracts";

export const RULE_ID = "uups-authorization";

export const LIMITATIONS = [
  "Inheritance is resolved only inside the analyzed file; bases from imports are treated as unknown.",
  "Access control is recognised from auth-style modifiers and caller or role checks in the body; custom schemes may be missed.",
  "Only the standard EIP-1967 implementation slot is accepted as the proxiable UUID.",
];

const SUGGESTION =
  "Implement `_authorizeUpgrade` with an owner or role check and return the EIP-1967 implementation slot from `proxiableUUID`.";

const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const AUTH_MODIFIER = /^(only|auth|restricted|requires?(Auth|Role)|isOwner|isAdmin|whenAuthorized)/i;
const AUTH_BODY = /\b(_checkOwner|_checkRole|hasRole|_requireOwner|_onlyOwner|isOwner|isAdmin)\s*\(|\b(require|assert)\s*\([^;]*(msg\.sender|_msgSender\s*\(\s*\)|owner|admin)|\bif\s*\([^)]*(msg\.sender|_msgSender\s*\(\s*\))[^)]*\)\s*(revert|\{)/;

export function detectUupsAuthorization(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const lineOf = makeLineIndex(v.clean);
  const ranges = extractContractRanges(v.clean);
  const functions = extractFunctions(v.clean);
  const fnContract = (bodyStart: number) => contractAtIndex(ranges, bodyStart)?.name;

  for (const c of ranges) {
    if (c.kind !== "contract" || c.abstract) continue;
    const chain = linearize(ranges, c.name);
    const isUups = chain.some((r) => r.bases.some((b) => /^UUPSUpgradeable$|^UUPSUpgradable$/.test(b)));
    if (!isUups) continue;
    const names = new Set(chain.map((r) => r.name));
    const own = (fname: string) => functions.filter((f) => f.kind === "function" && f.name === fname && names.has(fnContract(f.bodyStart) ?? ""));
    const startLine = lineOf(c.open);

    const auth = own("_authorizeUpgrade");
    if (auth.length === 0) {
      const unresolved = chain.some((r) => r.bases.some((b) => !chain.some((x) => x.name === b) && !/^(UUPSUpgradeable|UUPSUpgradable|Initializable|OwnableUpgradeable|Ownable|AccessControlUpgradeable|ContextUpgradeable)$/.test(b)));
      if (!unresolved) {
        findings.push({
          ruleId: RULE_ID,
          severity: "high",
          confidence: "medium",
          title: "Missing _authorizeUpgrade",
          message: `${c.name} inherits UUPSUpgradeable but no _authorizeUpgrade implementation is visible in its inheritance chain`,
          line: startLine,
          endLine: startLine,
          evidence: [`contract ${c.name} is ${c.bases.join(", ")}`],
          rationale: "Without an implementation the contract cannot compile as concrete, or upgrades are left to an unreviewed parent.",
          remediation: "Implement `_authorizeUpgrade(address) internal override onlyOwner`.",
        });
      }
    }
    for (const f of auth) {
      const mods = modifierNames(f.header);
      const guarded = mods.some((m) => AUTH_MODIFIER.test(m)) || AUTH_BODY.test(f.body);
      if (!guarded) {
        findings.push({
          ruleId: RULE_ID,
          severity: "critical",
          confidence: f.body.trim() === "" ? "high" : "medium",
          title: "Unrestricted _authorizeUpgrade",
          message: `_authorizeUpgrade in ${fnContract(f.bodyStart) ?? c.name} has no access control, so any caller can upgrade the proxy`,
          line: f.startLine,
          endLine: f.endLine,
          functionName: f.name,
          evidence: [`modifiers: ${mods.length ? mods.join(", ") : "none"}`, f.body.trim() === "" ? "empty body" : "no caller or role check in body"],
          rationale: "Anyone who can upgrade the implementation controls all proxy state and funds.",
          remediation: "Add an owner or role modifier, or revert unless msg.sender is authorized.",
        });
      }
    }

    for (const f of own("proxiableUUID")) {
      const returnsSlot = /_?IMPLEMENTATION_SLOT\b/i.test(f.body) || f.body.toLowerCase().includes(IMPLEMENTATION_SLOT);
      if (!returnsSlot) {
        findings.push({
          ruleId: RULE_ID,
          severity: "high",
          confidence: "medium",
          title: "Nonstandard proxiable UUID",
          message: "proxiableUUID does not return the EIP-1967 implementation slot, so upgrades to this implementation will be rejected or mis-tracked",
          line: f.startLine,
          endLine: f.endLine,
          functionName: f.name,
          evidence: [f.body.trim().slice(0, 120)],
          rationale: "UUPS upgrade checks compare proxiableUUID with the implementation slot.",
          remediation: `Return ${IMPLEMENTATION_SLOT} (ERC1967Utils.IMPLEMENTATION_SLOT).`,
        });
      }
    }
  }
  // Several children can share one unguarded parent; report each location once.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = `${f.title}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return buildResult(RULE_ID, unique, v.diagnostics, LIMITATIONS, SUGGESTION);
}
