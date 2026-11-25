import {
  extractCallables,
  findMatchingClose,
  FunctionModel,
  lineAndColumn,
  prepareSoliditySource,
} from "./solidity-source-utils";

export type TimelockUpgradeBypassKind =
  | "direct-admin-upgrade"
  | "emergency-upgrade-bypass"
  | "unprotected-delay-setter"
  | "unbounded-zero-delay";

export interface TimelockUpgradeBypassFinding {
  kind: TimelockUpgradeBypassKind;
  functionName: string;
  line: number;
  startColumn: number;
  endColumn: number;
  reason: string;
  confidence: number;
  evidence: string[];
  remediation: string;
}

export interface TimelockUpgradeBypassDetection {
  findings: TimelockUpgradeBypassFinding[];
  diagnostics: string[];
}

const UPGRADE_CALLABLE_NAMES =
  /^(?:upgradeTo|upgradeToAndCall|setImplementation|upgradeImplementation|_authorizeUpgrade|changeAdmin|setAdmin)$/i;

const EMERGENCY_UPGRADE_NAMES =
  /^(?:emergencyUpgrade|instantUpgrade|fastUpgrade|forceUpgrade|emergencySetImplementation|bypassUpgrade|quickUpgrade)$/i;

const DELAY_SETTER_NAMES =
  /^(?:setDelay|updateDelay|changeDelay|setTimelockDelay|updateTimelockDelay|setMinDelay|setExecutionDelay)$/i;

const TIMELOCK_INDICATORS =
  /\b(?:timelock|TimelockController|pendingUpgrade|queueUpgrade|scheduleUpgrade|executionDelay|minDelay|MIN_DELAY|MINIMUM_DELAY|eta|unlockTime)\b/i;

const TIMELOCK_CALLER_CHECK =
  /\b(?:onlyTimelock|msg\.sender\s*==\s*(?:address\(this\)|timelock|timelockAddress|timelockController)|(?:_?isTimelock|_?verifyTimelock|_?checkTimelock|requireTimelock)\s*\()/i;

const TIMELOCK_MATURITY_CHECK =
  /\b(?:isOperationReady|isReady|block\.timestamp\s*>=\s*(?:eta|unlockTime|pendingUpgrade|executionTime)|requireReady)\b/i;

const MIN_DELAY_CHECK =
  /\b(?:require|if)\s*\(\s*(?:[\w$]+\s*>=\s*(?:MIN_DELAY|MINIMUM_DELAY|MIN_TIMELOCK|ONE_DAY|TWO_DAYS|\d+\s*(?:days?|hours?|weeks?))|(?:MIN_DELAY|MINIMUM_DELAY)\s*<=\s*[\w$]+)/i;

const ACCESS_CONTROL_MODIFIER =
  /\b(?:onlyOwner|onlyAdmin|onlyRole\s*\([^)]*\)|onlyGovernor|onlyGuardian|auth|requiresAuth)\b/;

export function detectTimelockUpgradeBypass(
  input: unknown,
): TimelockUpgradeBypassDetection {
  const prepared = prepareSoliditySource(input, "Timelock upgrade bypass");
  if (!prepared.ok) {
    return { findings: [], diagnostics: [prepared.diagnostic] };
  }

  const source = input as string;
  const { code } = prepared;
  const findings: TimelockUpgradeBypassFinding[] = [];

  const contracts = [
    ...code.matchAll(
      /\b(?:contract|abstract\s+contract)\s+([A-Za-z_$][\w$]*)[^{]*\{/g,
    ),
  ].map((m) => {
    const open = m.index! + m[0].length - 1;
    return {
      name: m[1],
      start: open,
      end: findMatchingClose(code, open, "{", "}"),
    };
  });

  const callables = extractCallables(code).filter(
    (c) => c.kind === "function" && c.bodyStart !== -1,
  );

  for (const contract of contracts) {
    const contractBody = code.slice(contract.start, contract.end);
    const hasTimelockContext = TIMELOCK_INDICATORS.test(contractBody);

    const contractFunctions = callables.filter(
      (fn) => fn.start > contract.start && fn.bodyEnd < contract.end,
    );

    for (const fn of contractFunctions) {
      const fnBody = code.slice(fn.bodyStart, fn.bodyEnd);
      const fnHeader = fn.header;
      const isInternalOrPrivate = /\b(?:internal|private)\b/.test(fnHeader);

      // Case 1: Emergency / instant upgrade bypass function
      if (EMERGENCY_UPGRADE_NAMES.test(fn.name)) {
        const { line, column } = lineAndColumn(source, fn.start);
        findings.push({
          kind: "emergency-upgrade-bypass",
          functionName: fn.name,
          line,
          startColumn: column,
          endColumn: column + fn.name.length,
          reason: `Function '${fn.name}' allows instantaneous upgrades, bypassing standard timelock review delays.`,
          confidence: 0.95,
          evidence: [
            `Function identifier '${fn.name}' indicates an expedited upgrade bypass path.`,
            `Executes state changes without enforcing scheduled timelock maturation.`,
          ],
          remediation:
            "Route all implementation changes through the governance timelock. If emergency mitigations are required, consider a pausable circuit breaker rather than an unreviewed code substitution.",
        });
        continue;
      }

      // Case 2: Delay setter missing timelock caller restriction or unbounded minimum delay
      if (DELAY_SETTER_NAMES.test(fn.name)) {
        const hasTimelockCaller =
          TIMELOCK_CALLER_CHECK.test(fnHeader) ||
          TIMELOCK_CALLER_CHECK.test(fnBody);
        const hasMinDelayBound = MIN_DELAY_CHECK.test(fnBody);

        if (!hasTimelockCaller) {
          const { line, column } = lineAndColumn(source, fn.start);
          findings.push({
            kind: "unprotected-delay-setter",
            functionName: fn.name,
            line,
            startColumn: column,
            endColumn: column + fn.name.length,
            reason: `Delay parameter setter '${fn.name}' can be invoked without timelock governance authorization.`,
            confidence: 0.9,
            evidence: [
              `Function '${fn.name}' modifies timelock delay parameters.`,
              `Lacks verification that caller is the timelock itself or a timelocked governance controller.`,
            ],
            remediation:
              "Require msg.sender == address(this) or onlyTimelock on delay mutation entry points so delay changes must pass through the existing delay window.",
          });
        }

        if (!hasMinDelayBound) {
          const { line, column } = lineAndColumn(source, fn.start);
          findings.push({
            kind: "unbounded-zero-delay",
            functionName: fn.name,
            line,
            startColumn: column,
            endColumn: column + fn.name.length,
            reason: `Delay parameter setter '${fn.name}' permits zero or arbitrarily small delays, enabling immediate bypass of future upgrades.`,
            confidence: 0.85,
            evidence: [
              `Function '${fn.name}' does not enforce a constant non-zero minimum delay bound (e.g. MIN_DELAY).`,
            ],
            remediation:
              "Enforce an immutable non-zero lower bound (e.g. require(newDelay >= MIN_DELAY, 'Delay too short')) to prevent setting the delay to zero.",
          });
        }
        continue;
      }

      // Case 3: Direct upgrade function bypassing timelock in a timelocked upgradeable system
      if (
        hasTimelockContext &&
        (UPGRADE_CALLABLE_NAMES.test(fn.name) ||
          fn.name === "_authorizeUpgrade")
      ) {
        // Skip internal helpers that are not _authorizeUpgrade
        if (isInternalOrPrivate && fn.name !== "_authorizeUpgrade") {
          continue;
        }

        const passesThroughTimelock =
          TIMELOCK_CALLER_CHECK.test(fnHeader) ||
          TIMELOCK_CALLER_CHECK.test(fnBody) ||
          TIMELOCK_MATURITY_CHECK.test(fnBody);

        if (!passesThroughTimelock) {
          const hasAdminModifier =
            ACCESS_CONTROL_MODIFIER.test(fnHeader) ||
            ACCESS_CONTROL_MODIFIER.test(fnBody);
          const { line, column } = lineAndColumn(source, fn.start);

          findings.push({
            kind: "direct-admin-upgrade",
            functionName: fn.name,
            line,
            startColumn: column,
            endColumn: column + fn.name.length,
            reason: `Upgrade entry point '${fn.name}' relies on administrative privileges (${hasAdminModifier ? "admin/owner modifier" : "direct check"}) without enforcing timelock queuing and delay maturity.`,
            confidence: 0.9,
            evidence: [
              `Contract '${contract.name}' contains timelock structures or references.`,
              `Entry point '${fn.name}' authorizes upgrades without requiring caller to be the timelock or validating scheduled operation completion.`,
            ],
            remediation:
              "Enforce that upgrade execution requires timelock scheduling and execution, or restrict upgrade authorization exclusively to the timelock contract address.",
          });
        }
      }
    }
  }

  return { findings, diagnostics: [] };
}
