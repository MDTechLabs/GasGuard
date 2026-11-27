/**
 * GG-STORAGE-LAYOUT-001: storage layout risks across inheritance and compiler changes.
 *
 * Storage slots are assigned by the C3 linearization of the bases and by the
 * order of declarations, and the layout is only stable for a fixed compiler
 * version. In upgradeable code the rule reports:
 *
 *   missing-storage-gap         a base contract with state variables and no
 *                               __gap array, so variables added to it later
 *                               shift every derived contract
 *   shadowed-state-variable     a derived contract redeclares a base state
 *                               variable name and gets a separate slot
 *   multi-base-storage-order    several bases declare state variables, so the
 *                               inheritance list order decides the layout
 *   floating-pragma-upgradeable a non-exact pragma lets the compiler version
 *                               change between builds of upgradeable code
 *
 * Supported: Solidity 0.6 - 0.8.x, bases defined in the analyzed source only.
 * Two builds cannot be compared from one source, so the rule reports structural
 * risks, not diffs. See docs/rules/storage-layout-inheritance.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  type SolContract,
  makeFinding,
  prepareSource,
} from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';

export const RULE_ID = 'GG-STORAGE-LAYOUT-001';

export const LIMITATIONS = [
  'Only bases defined in the analyzed source are resolved; imported bases and their storage are not known.',
  'A contract is treated as upgradeable by its bases (Initializable, *Upgradeable) or by initialize and upgrade function names.',
  'Layouts of two builds cannot be compared from a single source; only structural risks are reported.',
];

const UPGRADEABLE_BASE_RE = /Upgradeable|Initializable/;
const UPGRADE_FN_RE = /^(initialize|__\w+_init(_unchained)?|_authorizeUpgrade|upgradeTo\w*)$/;
const GAP_RE = /^_{0,2}gap$/i;

export function detectLayoutInheritanceRisks(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const model = buildSourceModel(masked, source, diagnostics);
    const declOffset = (c: SolContract) => Math.max(0, masked.lastIndexOf(c.name, c.open));
    const allVars = [...model.contracts.values()].flatMap((m) => m.stateVars);
    const storageVars = (name: string) =>
      allVars.filter((v, i) => v.contract === name && !v.constant && !v.immutable && allVars.findIndex((w) => w.offset === v.offset) === i);

    const upgradeableNames = new Set<string>();
    for (const m of model.contracts.values()) {
      const fns = model.allFunctions.filter((f) => f.contract === m.contract.name);
      if (m.contract.bases.some((b) => UPGRADEABLE_BASE_RE.test(b)) || fns.some((f) => f.kind === 'function' && UPGRADE_FN_RE.test(f.name))) {
        upgradeableNames.add(m.contract.name);
      }
    }
    const inTree = new Set<string>();
    for (const m of model.contracts.values()) {
      if (m.linearization.some((l) => upgradeableNames.has(l.name))) for (const l of m.linearization) inTree.add(l.name);
    }

    const reported = new Set<string>();
    for (const m of model.contracts.values()) {
      const c = m.contract;
      if (c.kind !== 'contract' || !inTree.has(c.name)) continue;
      const own = storageVars(c.name);

      if (!m.isLeaf && own.length > 0 && !own.some((v) => GAP_RE.test(v.name))) {
        findings.push(
          makeFinding(source, declOffset(c), {
            ruleId: RULE_ID,
            contract: c.name,
            kind: 'missing-storage-gap',
            severity: 'medium',
            confidence: 'high',
            message: `${c.name} is inherited by other contracts and declares state variables but no __gap array; adding a variable to it later shifts the slots of every derived contract.`,
            severityRationale: 'A shifted layout corrupts existing storage on upgrade, but only once the base is changed.',
            confidenceEvidence: [`${c.name} has ${own.length} storage variable(s)`, 'it has in-source derived contracts', 'no variable named __gap'],
            remediation: 'Reserve space with `uint256[50] private __gap;` and shrink it when adding variables.',
          }),
        );
      }

      const seen = new Map<string, string>();
      for (const l of [...m.linearization].reverse()) {
        for (const v of storageVars(l.name)) {
          const baseContract = seen.get(v.name);
          const key = `shadow:${v.offset}`;
          if (baseContract && baseContract !== l.name && !reported.has(key)) {
            reported.add(key);
            findings.push(
              makeFinding(source, v.offset, {
                ruleId: RULE_ID,
                contract: l.name,
                kind: 'shadowed-state-variable',
                severity: 'medium',
                confidence: 'high',
                message: `${l.name} declares state variable ${v.name}, which ${baseContract} already declares; the two live in separate slots and code in each contract reads a different value.`,
                severityRationale: 'Shadowed storage splits one logical value in two and changes the layout compared with a version that reused the base variable.',
                confidenceEvidence: [`${v.name} is declared in ${baseContract} and ${l.name}`],
                remediation: `Remove the redeclaration in ${l.name} and use the inherited variable, or rename it.`,
                details: { base: baseContract },
              }),
            );
          }
          if (!seen.has(v.name)) seen.set(v.name, l.name);
        }
      }

      const storageBases = c.bases.filter((b) => model.contracts.has(b) && storageVars(b).length > 0);
      const orderKey = `order:${c.name}`;
      if (storageBases.length >= 2 && !reported.has(orderKey)) {
        reported.add(orderKey);
        findings.push(
          makeFinding(source, declOffset(c), {
            ruleId: RULE_ID,
            contract: c.name,
            kind: 'multi-base-storage-order',
            severity: 'low',
            confidence: 'medium',
            message: `${c.name} inherits ${storageBases.join(', ')}, which all declare state variables; the order in the inheritance list decides the slot layout and reordering it breaks upgrades.`,
            severityRationale: 'The risk only materialises on a later edit of the inheritance list, which is easy to miss in review.',
            confidenceEvidence: [`bases with storage: ${storageBases.join(', ')}`],
            remediation: 'Freeze the inheritance order, record the layout with `solc --storage-layout`, and diff it in CI before upgrades.',
            details: { bases: storageBases },
          }),
        );
      }
    }

    const pragma = /pragma\s+solidity\s+([^;]+);/.exec(masked);
    if (pragma && inTree.size > 0 && !/^\s*=?\s*\d+\.\d+\.\d+\s*$/.test(pragma[1])) {
      findings.push(
        makeFinding(source, pragma.index, {
          ruleId: RULE_ID,
          kind: 'floating-pragma-upgradeable',
          severity: 'low',
          confidence: 'medium',
          message: `pragma solidity ${pragma[1].trim()} allows several compiler versions for upgradeable code, so the storage layout can differ between builds.`,
          severityRationale: 'Layout rules have changed between compiler releases; an unpinned compiler makes the deployed and upgraded layouts hard to reproduce.',
          confidenceEvidence: [`non-exact pragma: ${pragma[1].trim()}`, `upgradeable contracts: ${[...inTree].join(', ')}`],
          remediation: 'Pin an exact solc version and record it with the storage layout output for every release.',
        }),
      );
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
