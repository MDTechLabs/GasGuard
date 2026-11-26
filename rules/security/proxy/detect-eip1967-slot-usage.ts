/**
 * EIP-1967 implementation and admin slot usage (#1309)
 *
 * Checks bytes32 slot constants named like an implementation or admin slot and reports:
 *  - a hex value that is not the standard slot (or an implementation and admin value swapped),
 *  - `keccak256("eip1967.proxy.implementation")` without the `- 1` offset, or with the wrong label,
 *  - proxies that keep `implementation` or `admin` in a plain storage variable next to delegatecall.
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  failedResult,
  makeLineIndex,
  validateSource,
} from "../_shared/solidity-source";
import { depthInContract, extractContractRanges } from "../_shared/solidity-contracts";

export const RULE_ID = "eip1967-slot-usage";

export const LIMITATIONS = [
  "Only bytes32 constants whose names mention implementation or admin together with slot are checked.",
  "Slot values computed through helper functions or imported constants are not evaluated.",
  "The storage variable check needs a delegatecall inside the same contract.",
];

const SUGGESTION =
  "Use the EIP-1967 slots (implementation 0x3608...2bbc, admin 0xb531...6103) and keep proxy state out of regular storage.";

const STANDARD = {
  implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
};

function kindOfName(name: string): "implementation" | "admin" | null {
  if (!/slot/i.test(name)) return null;
  if (/impl/i.test(name)) return "implementation";
  if (/admin/i.test(name)) return "admin";
  return null;
}

export function detectEip1967SlotUsage(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];
  const lineOf = makeLineIndex(v.clean);
  const add = (f: Omit<DetectorFinding, "ruleId" | "endLine">) => findings.push({ ruleId: RULE_ID, endLine: f.line, ...f });

  // Offsets are identical in `code` and `v.clean`, so string contents can be read from the original.
  const declRe = /\bbytes32\s+(?:(?:private|internal|public|constant|immutable)\s+)*([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(v.clean)) !== null) {
    const kind = kindOfName(m[1]);
    if (!kind) continue;
    const other = kind === "implementation" ? "admin" : "implementation";
    const original = code.slice(m.index, m.index + m[0].length);
    const expr = original.slice(original.indexOf("=") + 1).replace(/;\s*$/, "").trim();
    const line = lineOf(m.index);
    const hex = /0x[0-9a-fA-F]{64}\b/.exec(expr)?.[0].toLowerCase();
    const label = /keccak256\s*\(\s*["']([^"']*)["']\s*\)/.exec(expr)?.[1];

    if (hex) {
      if (hex === STANDARD[kind]) continue;
      const swapped = hex === STANDARD[other];
      add({
        severity: swapped ? "high" : "medium",
        confidence: "high",
        title: swapped ? "Implementation and admin slots swapped" : "Nonstandard EIP-1967 slot",
        message: swapped
          ? `${m[1]} holds the ${other} slot value, so the ${kind} and ${other} would overwrite each other`
          : `${m[1]} is not the standard EIP-1967 ${kind} slot`,
        line,
        evidence: [expr],
        rationale: "Explorers, tooling and upgrade plugins read the standard slots; other values break them or collide.",
        remediation: `Set ${m[1]} to ${STANDARD[kind]}.`,
      });
    } else if (label !== undefined) {
      const expected = `eip1967.proxy.${kind}`;
      if (label !== expected) {
        add({
          severity: "medium",
          confidence: "high",
          title: "Wrong EIP-1967 slot label",
          message: `${m[1]} hashes "${label}" instead of "${expected}"`,
          line,
          evidence: [expr],
          rationale: "A different label yields a different slot than the one tooling expects.",
          remediation: `Use bytes32(uint256(keccak256("${expected}")) - 1).`,
        });
      } else if (!/-\s*1\b/.test(expr)) {
        add({
          severity: "medium",
          confidence: "high",
          title: "EIP-1967 slot missing the minus one offset",
          message: `${m[1]} hashes the label without subtracting 1, so the slot preimage is known and it is not the standard slot`,
          line,
          evidence: [expr],
          rationale: "EIP-1967 subtracts 1 so the slot cannot be reached by a mapping or array key.",
          remediation: `Use bytes32(uint256(keccak256("${expected}")) - 1).`,
        });
      }
    } else {
      add({
        severity: "low",
        confidence: "low",
        title: "Unverifiable EIP-1967 slot",
        message: `${m[1]} is not a literal or a keccak256 of a label, so it cannot be checked against the standard`,
        line,
        evidence: [expr],
        rationale: "The value could not be evaluated statically.",
        remediation: "Use the literal standard slot value.",
      });
    }
  }

  // Plain storage variables for implementation or admin in a delegatecall proxy.
  for (const c of extractContractRanges(v.clean)) {
    if (c.kind !== "contract") continue;
    const body = v.clean.slice(c.open, c.close);
    if (!/\bdelegatecall\b/.test(body)) continue;
    const varRe = /\baddress\s+(?:(?:public|private|internal)\s+)?(_?implementation|_?admin)\s*(?:;|=)/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(body)) !== null) {
      const index = c.open + vm.index;
      if (depthInContract(v.clean, c, index) !== 1) continue;
      add({
        severity: "high",
        confidence: "medium",
        title: "Proxy keeps the " + vm[1].replace(/^_/, "") + " in regular storage",
        message: `${c.name} delegatecalls and stores \`${vm[1]}\` in slot-ordered storage, which can collide with the logic contract's layout`,
        line: lineOf(index),
        evidence: [vm[0]],
        rationale: "A regular storage variable shares slots with the implementation's variables under delegatecall.",
        remediation: "Store it at the EIP-1967 slot and access it with assembly or StorageSlot.",
      });
    }
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
