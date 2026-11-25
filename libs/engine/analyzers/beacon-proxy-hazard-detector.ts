import {
  extractCallables,
  findMatchingClose,
  FunctionModel,
  lineAndColumn,
  prepareSoliditySource,
} from "./solidity-source-utils";

export type BeaconProxyHazardKind =
  | "unvalidated-beacon-address"
  | "uninitialized-proxy-deployment"
  | "unprotected-beacon-upgrade"
  | "empty-implementation-upgrade"
  | "missing-initializer-disable";

export interface BeaconProxyHazardFinding {
  kind: BeaconProxyHazardKind;
  line: number;
  startColumn: number;
  endColumn: number;
  callableName: string;
  reason: string;
  confidence: number;
  evidence: string[];
  remediation: string;
}

export interface BeaconProxyHazardDetection {
  findings: BeaconProxyHazardFinding[];
  diagnostics: string[];
}

const BEACON_PROXY_CREATION = /\bnew\s+BeaconProxy\s*\(/g;
const UPGRADE_CALLABLE = /\bfunction\s+(?:upgradeTo|upgradeToAndCall)\s*\(/g;
const ACCESS_CONTROL =
  /\b(?:onlyOwner|onlyAdmin|onlyRole\s*\([^)]*\)|onlyGovernor|auth|requiresAuth)\b/;
const CONTRACT_CODE_CHECK =
  /\b(?:code\.length\s*>\s*0|isContract\s*\(|Address\.isContract)\b/;
const ZERO_ADDRESS_CHECK = /\b(?:!=?\s*address\(0\)|address\(0\)\s*!=?)\b/;
const DISABLE_INITIALIZERS_CALL = /\b_disableInitializers\s*\(\s*\)/;

export function detectBeaconProxyHazards(
  input: unknown,
): BeaconProxyHazardDetection {
  const prepared = prepareSoliditySource(input, "Beacon proxy hazard");
  if (!prepared.ok) {
    return { findings: [], diagnostics: [prepared.diagnostic] };
  }

  const source = input as string;
  const { code, text } = prepared;
  const findings: BeaconProxyHazardFinding[] = [];

  const contracts = [
    ...code.matchAll(
      /\b(?:contract|abstract\s+contract)\s+([A-Za-z_$][\w$]*)[^{]*\{/g,
    ),
  ].map((m) => {
    const open = m.index! + m[0].length - 1;
    return {
      name: m[1],
      headerStart: m.index!,
      start: open,
      end: findMatchingClose(code, open, "{", "}"),
    };
  });

  const callables = extractCallables(code);

  // 1. Detect beacon proxy creation hazards (new BeaconProxy(beacon, data))
  let match: RegExpExecArray | null;
  const creationRegex = new RegExp(BEACON_PROXY_CREATION.source, "g");
  while ((match = creationRegex.exec(code)) !== null) {
    const open = code.indexOf("(", match.index);
    const close = findMatchingClose(code, open);
    if (close < 0) continue;

    const argsText = text.slice(open + 1, close).trim();
    const args = argsText.split(",").map((a) => a.trim());
    const { line, column } = lineAndColumn(source, match.index);

    // Hazard: empty initialization data in beacon proxy deployment
    if (
      args.length >= 2 &&
      (args[1] === '""' ||
        args[1] === 'bytes("")' ||
        args[1] === 'hex""' ||
        args[1] === "''")
    ) {
      findings.push({
        kind: "uninitialized-proxy-deployment",
        line,
        startColumn: column,
        endColumn: column + match[0].length,
        callableName: "new BeaconProxy",
        reason:
          "BeaconProxy is deployed with empty initialization data ('\"\"'), leaving the newly deployed proxy uninitialized and vulnerable to front-running takeover.",
        confidence: 0.95,
        evidence: [
          `BeaconProxy instantiation arguments: [${argsText}]`,
          "Passing empty initialization payload omits atomic contract initialization.",
        ],
        remediation:
          "Pass encoded initialization calldata (e.g. abi.encodeWithSelector(Implementation.initialize.selector, ...)) to initialize the proxy atomically upon deployment.",
      });
    }

    // Hazard: unvalidated beacon address parameter in beacon creation wrapper
    const enclosingFn = callables.find(
      (c) =>
        c.bodyStart !== -1 &&
        match!.index > c.bodyStart &&
        match!.index < c.bodyEnd,
    );
    if (enclosingFn) {
      const fnBody = code.slice(enclosingFn.bodyStart, enclosingFn.bodyEnd);
      const beaconArg = args[0];
      const hasZeroCheck = ZERO_ADDRESS_CHECK.test(fnBody);
      const hasCodeCheck = CONTRACT_CODE_CHECK.test(fnBody);

      if (
        !hasZeroCheck &&
        !hasCodeCheck &&
        /^[A-Za-z_$][\w$]*$/.test(beaconArg)
      ) {
        findings.push({
          kind: "unvalidated-beacon-address",
          line,
          startColumn: column,
          endColumn: column + match[0].length,
          callableName: enclosingFn.name,
          reason: `BeaconProxy deployment passes unvalidated beacon address '${beaconArg}' without verifying non-zero address or contract code.`,
          confidence: 0.85,
          evidence: [
            `Function '${enclosingFn.name}' accepts parameter '${beaconArg}'.`,
            "Deployment proceeds without validating that the beacon has deployed code.",
          ],
          remediation:
            "Validate that the beacon address is non-zero and contains contract code (e.g. require(beacon.code.length > 0, 'Invalid beacon')) before creating proxies.",
        });
      }
    }
  }

  // 2. Detect UpgradeableBeacon implementation upgrade hazards
  for (const contract of contracts) {
    const isBeaconContract =
      /UpgradeableBeacon|IBeacon|Beacon/i.test(contract.name) ||
      /\b(?:_implementation|implementation)\b/.test(
        code.slice(contract.start, contract.end),
      );

    if (!isBeaconContract) continue;

    const contractCallables = callables.filter(
      (c) =>
        c.start > contract.start &&
        c.bodyEnd < contract.end &&
        c.kind === "function",
    );

    for (const fn of contractCallables) {
      if (
        fn.name === "upgradeTo" ||
        fn.name === "upgradeToAndCall" ||
        fn.name === "setImplementation"
      ) {
        const fnBody = code.slice(fn.bodyStart, fn.bodyEnd);
        const fnHeader = fn.header;
        const isInternalOrPrivate = /\b(?:internal|private)\b/.test(fnHeader);
        if (isInternalOrPrivate) continue;

        const { line, column } = lineAndColumn(source, fn.start);
        const hasAccessControl =
          ACCESS_CONTROL.test(fnHeader) || ACCESS_CONTROL.test(fnBody);
        const hasCodeCheck = CONTRACT_CODE_CHECK.test(fnBody);

        if (!hasAccessControl) {
          findings.push({
            kind: "unprotected-beacon-upgrade",
            line,
            startColumn: column,
            endColumn: column + fn.name.length,
            callableName: fn.name,
            reason: `Beacon upgrade function '${fn.name}' lacks access control modifiers, allowing arbitrary callers to rewrite implementation for all beacon proxies.`,
            confidence: 0.95,
            evidence: [
              `Function '${fn.name}' modifies the beacon logic implementation address.`,
              "Lacks onlyOwner, onlyAdmin, or role-based authorization check.",
            ],
            remediation:
              "Add an explicit access control modifier (e.g. onlyOwner) to restrict beacon implementation upgrades.",
          });
        }

        if (!hasCodeCheck) {
          findings.push({
            kind: "empty-implementation-upgrade",
            line,
            startColumn: column,
            endColumn: column + fn.name.length,
            callableName: fn.name,
            reason: `Beacon upgrade function '${fn.name}' does not verify that the new implementation address contains contract code, which would brick all pointing beacon proxies.`,
            confidence: 0.9,
            evidence: [
              `Function '${fn.name}' assigns new logic implementation address.`,
              "No verification that newImplementation.code.length > 0.",
            ],
            remediation:
              "Verify require(newImplementation.code.length > 0, 'Implementation must be a contract') prior to updating the beacon.",
          });
        }
      }
    }
  }

  // 3. Detect missing initializer disable in upgradeable implementation constructors
  for (const contract of contracts) {
    const contractBody = code.slice(contract.start, contract.end);
    const contractHeaderAndBody = code.slice(
      contract.headerStart,
      contract.end,
    );
    const isUpgradeableImplementation =
      /\b(?:Initializable|UUPSUpgradeable|UpgradeableBeacon)\b/.test(
        contractHeaderAndBody,
      ) && /\bfunction\s+initialize\s*\(/.test(contractBody);

    if (isUpgradeableImplementation) {
      const constructorCallable = callables.find(
        (c) =>
          c.start > contract.start &&
          c.bodyEnd < contract.end &&
          c.kind === "constructor",
      );

      const hasDisable = constructorCallable
        ? DISABLE_INITIALIZERS_CALL.test(
            code.slice(
              constructorCallable.bodyStart,
              constructorCallable.bodyEnd,
            ),
          )
        : false;

      if (!hasDisable) {
        const targetOffset = constructorCallable
          ? constructorCallable.start
          : contract.start;
        const { line, column } = lineAndColumn(source, targetOffset);

        findings.push({
          kind: "missing-initializer-disable",
          line,
          startColumn: column,
          endColumn: column + (constructorCallable ? 11 : contract.name.length),
          callableName: constructorCallable ? "constructor" : contract.name,
          reason: `Upgradeable implementation contract '${contract.name}' does not invoke _disableInitializers() in its constructor, leaving the implementation logic contract open to unauthorized initialization.`,
          confidence: 0.9,
          evidence: [
            `Contract '${contract.name}' inherits upgradeable/initializable patterns with an initialize() function.`,
            "Constructor is missing _disableInitializers() invocation.",
          ],
          remediation:
            "Add constructor() { _disableInitializers(); } to lock the implementation contract from being initialized directly.",
        });
      }
    }
  }

  return { findings, diagnostics: [] };
}
