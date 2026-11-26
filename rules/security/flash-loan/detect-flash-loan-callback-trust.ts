/**
 * Flash-loan callback trust boundaries (#1307)
 *
 * Finds flash-loan receiver callbacks (ERC-3156 onFlashLoan, Aave executeOperation, Balancer
 * receiveFlashLoan, Uniswap callbacks and similar) that are externally reachable and reports:
 *  - no check that msg.sender is the expected lender or pool,
 *  - an initiator or sender argument that is never compared, so a third party can trigger the
 *    callback on behalf of this contract.
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  collectGuards,
  extractFunctions,
  failedResult,
  splitStatements,
  validateSource,
} from "../_shared/solidity-source";
import { modifierNames } from "../_shared/solidity-contracts";

export const RULE_ID = "flash-loan-callback-trust";

export const LIMITATIONS = [
  "Callbacks are recognised by well-known names; custom callback names are not detected.",
  "Caller validation is matched textually: a guard or modifier that mentions msg.sender counts as validation.",
  "The lender address itself is not resolved, so a check against an attacker-controlled address is not reported.",
];

const SUGGESTION = "Require msg.sender to be the trusted lender or pool and require the initiator to be address(this).";

export const CALLBACK_NAMES = [
  "onFlashLoan",
  "executeOperation",
  "receiveFlashLoan",
  "uniswapV2Call",
  "pancakeCall",
  "uniswapV3FlashCallback",
  "callFunction",
  "onMorphoFlashLoan",
];

const AUTH_MODIFIER = /^(only|auth|restricted|requires?(Auth|Role)|isLender|isPool)/i;
const INITIATOR_PARAM = /^_?(initiator|sender|caller)$/i;

export function detectFlashLoanCallbackTrust(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];

  for (const fn of extractFunctions(v.clean)) {
    if (fn.kind !== "function" || !CALLBACK_NAMES.includes(fn.name)) continue;
    if (fn.visibility === "internal" || fn.visibility === "private") continue;

    const guards = collectGuards(splitStatements(fn, v.clean));
    const callerChecked =
      modifierNames(fn.header).some((m) => AUTH_MODIFIER.test(m)) ||
      guards.some((g) => /\bmsg\.sender\b|\b_msgSender\s*\(\s*\)/.test(g.condition)) ||
      /\bmsg\.sender\s*[!=]=|[!=]=\s*msg\.sender\b/.test(fn.body);

    if (!callerChecked) {
      findings.push({
        ruleId: RULE_ID,
        severity: "high",
        confidence: "medium",
        title: "Flash-loan callback does not authenticate the caller",
        message: `${fn.name} never checks msg.sender, so anyone can call it directly with crafted arguments`,
        line: fn.startLine,
        endLine: fn.endLine,
        functionName: fn.name,
        evidence: [`${fn.name}(${fn.params.map((p) => `${p.type} ${p.name}`.trim()).join(", ")})`, "no msg.sender guard or auth modifier"],
        rationale: "The callback usually moves funds or approvals, and its arguments are only trustworthy when the lender is the caller.",
        remediation: "Require msg.sender to equal the trusted lender, pool or vault address.",
      });
    }

    const initiator = fn.params.find((p) => p.name && INITIATOR_PARAM.test(p.name));
    if (initiator) {
      const name = initiator.name.replace(/\$/g, "\\$");
      const compared = new RegExp(`\\b${name}\\b\\s*[!=]=|[!=]=\\s*(?:address\\s*\\(\\s*)?\\b${name}\\b`).test(fn.body) ||
        guards.some((g) => new RegExp(`\\b${name}\\b`).test(g.condition));
      if (!compared) {
        findings.push({
          ruleId: RULE_ID,
          severity: "medium",
          confidence: "medium",
          title: "Flash-loan initiator is not validated",
          message: `${fn.name} ignores \`${initiator.name}\`, so a third party can start a loan that uses this contract as the receiver`,
          line: fn.startLine,
          endLine: fn.endLine,
          functionName: fn.name,
          evidence: [`parameter ${initiator.type} ${initiator.name} is never compared`],
          rationale: "Without an initiator check, an attacker can make the lender call this receiver and trigger its logic.",
          remediation: `Require ${initiator.name} == address(this) or an allow-listed operator.`,
        });
      }
    }
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
