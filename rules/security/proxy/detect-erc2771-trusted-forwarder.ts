/**
 * ERC-2771 trusted-forwarder assumptions (#1315)
 *
 * Checks custom sender-suffix extraction, raw msg.sender authorization in
 * ERC2771Context-derived contracts, and externally callable forwarder updates.
 *
 * Supported: Solidity 0.8.x source text, single file. This is lexical analysis,
 * not compiler AST analysis; imported inheritance and modifier bodies are unknown.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  extractFunctions,
  failedResult,
  isExternallyCallable,
  makeLineIndex,
  validateSource,
} from "../_shared/solidity-source";
import { contractAtIndex, extractContractRanges, linearize, modifierNames } from "../_shared/solidity-contracts";

export const RULE_ID = "erc2771-trusted-forwarder";

export const LIMITATIONS = [
  "Supports Solidity 0.8.x source text only; compiler versions, ASTs, IR and compiler settings are not consulted.",
  "Inheritance and modifier bodies are resolved only when defined in the analyzed file; imported bases and aliases are unknown.",
  "Forwarder checks, access control and sender semantics are matched lexically; custom schemes may be missed or flagged.",
  "No project code, build hooks or package scripts are executed.",
];

const SUGGESTION =
  "Authenticate msg.sender as the configured trusted forwarder before decoding the calldata suffix, use _msgSender() for forwarded identities, and restrict forwarder updates.";

const AUTH_MODIFIER = /^(only|auth|restricted|requires?(Auth|Role)|isOwner|isAdmin|whenAuthorized)/i;
const AUTH_BODY =
  /\b(?:_checkOwner|_checkRole|hasRole|_requireOwner|_onlyOwner)\s*\(|\b(?:require|assert)\s*\([^;]*(?:\bmsg\.sender\b|\b_msgSender\s*\(\s*\))[^;]*(?:==|!=)[^;]*(?:owner|admin|role|authorized|governor|guardian)|\b(?:require|assert)\s*\([^;]*(?:owner|admin|role|authorized|governor|guardian)[^;]*(?:==|!=)[^;]*(?:\bmsg\.sender\b|\b_msgSender\s*\(\s*\))/i;
const FORWARDER_GATE =
  /\b(?:_isTrustedForwarder|isTrustedForwarder)\s*\(\s*msg\.sender\s*\)|\bmsg\.sender\s*==\s*_?trustedForwarder\b|\b_?trustedForwarder\s*==\s*msg\.sender\b/i;
const CONTEXT_BASE = /^ERC2771Context(?:Upgradeable)?$/;

function isAuthorized(fn: ReturnType<typeof extractFunctions>[number]): boolean {
  return modifierNames(fn.header).some((name) => AUTH_MODIFIER.test(name)) || AUTH_BODY.test(fn.body);
}

function suffixExtraction(body: string): boolean {
  return (
    (/\bcalldataload\s*\(/.test(body) && /\bcalldatasize\s*\(/.test(body)) ||
    /msg\.data\s*\[[^\]]*(?:calldatasize|\.length)[^\]]*\]/.test(body)
  );
}

function hasRawSenderAuthorization(body: string): boolean {
  return (
    /\b(?:require|assert)\s*\([^;]*\bmsg\.sender\b[^;]*(?:==|!=)/i.test(body) ||
    /\b(?:require|assert)\s*\([^;]*(?:==|!=)[^;]*\bmsg\.sender\b/i.test(body) ||
    /\bif\s*\([^)]*\bmsg\.sender\b[^)]*(?:==|!=)/i.test(body)
  );
}

export function detectErc2771TrustedForwarder(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);

  const findings: DetectorFinding[] = [];
  const lineOf = makeLineIndex(v.clean);
  const ranges = extractContractRanges(v.clean);
  const functions = extractFunctions(v.clean);
  const add = (finding: Omit<DetectorFinding, "ruleId" | "endLine">) =>
    findings.push({ ruleId: RULE_ID, endLine: finding.line, ...finding });

  for (const fn of functions) {
    const owner = contractAtIndex(ranges, fn.bodyStart);
    if (!owner || owner.kind !== "contract") continue;

    if (fn.name === "_msgSender" && suffixExtraction(fn.body) && !FORWARDER_GATE.test(fn.body)) {
      add({
        severity: "high",
        confidence: "medium",
        title: "Calldata sender suffix is not authenticated",
        message: `${owner.name} decodes a sender from the calldata suffix without checking that msg.sender is a trusted forwarder`,
        line: fn.startLine,
        functionName: fn.name,
        evidence: ["_msgSender reads calldata size/data", "no trusted-forwarder check for msg.sender is visible"],
        rationale: "Without authenticating the caller, an untrusted caller can append an arbitrary 20-byte sender suffix.",
        remediation: "Decode the appended sender only when msg.sender passes an explicit trusted-forwarder check; otherwise return msg.sender.",
      });
    }

    if (!isExternallyCallable(fn) || fn.name === "_msgSender" || fn.name === "isTrustedForwarder") continue;

    const chain = linearize(ranges, owner.name);
    const uses2771Context = chain.some((contract) => contract.bases.some((base) => CONTEXT_BASE.test(base)));
    if (
      uses2771Context &&
      hasRawSenderAuthorization(fn.body) &&
      !/\btrustedForwarder\b/i.test(fn.body)
    ) {
      add({
        severity: "medium",
        confidence: "medium",
        title: "Raw msg.sender used with ERC-2771 context",
        message: `${fn.name}() checks msg.sender in ${owner.name}, which may be the forwarder rather than the end user`,
        line: fn.startLine,
        functionName: fn.name,
        evidence: ["contract inherits ERC2771Context", "authorization condition references raw msg.sender"],
        rationale: "ERC-2771 appends the end-user address to forwarded calls; msg.sender is the forwarder while _msgSender() represents the user.",
        remediation: "Use _msgSender() for end-user authorization, or document and explicitly validate a forwarder-only check.",
      });
    }

    if (
      isExternallyCallable(fn) &&
      /forwarder/i.test(fn.name) &&
      /\b_?trustedForwarder\s*=/.test(fn.body) &&
      !isAuthorized(fn)
    ) {
      add({
        severity: "high",
        confidence: "medium",
        title: "Trusted forwarder can be changed without authorization",
        message: `${fn.name}() updates the trusted forwarder without a recognizable access-control check`,
        line: fn.startLine,
        functionName: fn.name,
        evidence: ["externally callable function assigns trustedForwarder", "no recognized authorization modifier or owner/role check is visible"],
        rationale: "An attacker-selected forwarder can supply arbitrary end-user identities to ERC-2771-aware logic.",
        remediation: "Restrict forwarder updates to a trusted owner or role and validate the replacement address.",
      });
    }
  }

  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
