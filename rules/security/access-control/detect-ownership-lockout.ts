import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  SolStateVar,
  findMatching,
  lineColumn,
  makeFinding,
  msgSenderComparands,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';
import {
  ContractModel,
  buildSourceModel,
  calleesOf,
  leadingComment,
} from '../lib/solidity-inheritance';

export const RULE_ID = 'sol-028';

export type OwnershipStatus = 'risk' | 'safe' | 'exempt' | 'immutable' | 'permissionless';

export interface OwnershipLockoutOptions {
  exemptContracts?: string[];
  exemptFunctions?: string[];
  exemptPatterns?: string[];
  adminVariables?: string[];
  adminRoles?: string[];
  includeOneStepTransfers?: boolean;
}

export interface OwnershipFlow {
  contract: string;
  function: string;
  line: number;
  kind: string;
  status: OwnershipStatus;
  admin?: string;
  pending?: string;
  role?: string;
  guard?: string;
  reason?: string;
}

export interface OwnershipContractEntry {
  contract: string;
  line: number;
  status: OwnershipStatus;
  adminVariables: string[];
  pendingVariables: string[];
  adminFunctions: string[];
  reason: string;
}

export interface OwnershipLockoutResult extends RuleResult {
  flows: OwnershipFlow[];
  contracts: OwnershipContractEntry[];
}

const ADMIN_NAME =
  /^(?:_?owner|_?admin|_?governor|_?governance|_?manager|_?controller|_?operator|_?authority|_?guardian|_?timelock|_?custodian|_?superAdmin|_?root|_?chief|_?multisig)$/i;
const ADMIN_LIKE =
  /(owner|admin|govern|manager|controller|authority|guardian|timelock|custodian|operator|root|chief)/i;
const PENDING_NAME =
  /^(?:_?pending(?:Owner|Admin|Governor|Governance|Manager|Controller|Authority|Guardian|Timelock|Custodian|SuperAdmin)|_?newOwner|_?proposedOwner|_?ownerCandidate)$/i;
const ADMIN_MAPPING =
  /^(?:_?(?:admins?|isAdmin|operators?|isOperator|managers?|isManager|governors?|isGovernor|controllers?|isController|authorities|isAuthority|guardians?|isGuardian|keepers?|isKeeper))$/i;
const ADMIN_MODIFIER =
  /^(?:only(?:Owner|Admin|Governance|Governor|Manager|Controller|Authority|Guardian|Timelock|Custodian|SuperAdmin)|auth|requiresAuth|restricted|isOwner)$/;
const ACCESS_MODIFIER =
  /^(?:only[A-Z]\w*|auth|requiresAuth|restricted|isOwner|onlyRole)$/;
const NOT_ACCESS_MODIFIER = /^(?:onlyInitializing|onlyProxy|onlyDelegateCall)$/;
const TRANSFER_FN =
  /^(?:transfer|change|set|update|replace|propose|nominate|offer|initiate|start|begin|handover)(?:Ownership|Owner|Admin|Governor|Governance|Manager|Controller|Authority|Guardian|Timelock|Custodian|SuperAdmin|OwnershipTransfer|AdminTransfer|GovernanceTransfer)$/i;
const ACCEPT_FN =
  /^(?:accept|claim|become|complete|finalize|confirm)(?:Ownership|Owner|Admin|Governor|Governance|Manager|Controller|Authority|Guardian|Timelock|Custodian|SuperAdmin|OwnershipTransfer|AdminTransfer|GovernanceTransfer)$/i;
const RENOUNCE_FN =
  /^(?:renounce|burn|resign|abdicate|surrender|relinquish)(?:Ownership|Owner|Admin|Governor|Governance|Manager|Controller|Authority|Guardian|Timelock|Custodian|SuperAdmin)$/i;
const ROLE_FN =
  /^(?:_?revokeRole|_?renounceRole|_?removeRole|_?revokeAdmin|_?removeAdmin|_?revokeGovernor|_?removeGovernor)$/i;
const ROLE_ADMIN =
  /DEFAULT_ADMIN_ROLE|ADMIN_ROLE|GOVERNOR_ROLE|GOVERNANCE_ROLE|OWNER_ROLE|MANAGER_ROLE|CONTROLLER_ROLE|AUTHORITY_ROLE|SUPER_ADMIN_ROLE|TIMELOCK_ROLE/i;
const ROLE_REJECT =
  /\b(?:role|_role|adminRole|admin_role)\s*!=\s*(?:DEFAULT_ADMIN_ROLE|ADMIN_ROLE|GOVERNOR_ROLE|GOVERNANCE_ROLE|OWNER_ROLE)\b/;
const CONTRACT_ANNOTATION =
  /gasguard-ownership-lockout-exempt|gasguard-immutable-admin|gasguard-permissionless|@custom:(?:ownership-lockout-exempt|immutable-admin|no-admin|permissionless)/i;
const FUNCTION_ANNOTATION =
  /gasguard-ownership-lockout-exempt|gasguard-permissionless|@custom:(?:ownership-lockout-exempt|permissionless)/i;
const ALWAYS_REVERTS = /^\s*(?:\{\s*)?(?:revert|require\s*\(\s*false|assert\s*\(\s*false)\b/;
const ZERO_EXPR = /^(?:address\s*\(\s*0\s*\)|0x0+|0)$/i;
const DEFINITELY_NONZERO = /^(?:msg\.sender|tx\.origin|this)$/i;
const ADDRESS_TYPE = /^address(?:\s+payable)?$/;

const CONFIDENCE_VALUE: Record<SecurityFinding['confidence'], number> = {
  low: 0.35,
  medium: 0.65,
  high: 0.9,
};

interface OwnershipWrite {
  root: string;
  rhs: string;
  text: string;
  offset: number;
  length: number;
  line: number;
  helper?: string;
}

interface AuthEvidence {
  any: string | null;
  admin: string | null;
}

interface AnalysisContext {
  source: string;
  model: ContractModel;
  adminNames: Set<string>;
  pendingNames: Set<string>;
  roleConstants: string[];
  adminMappings: Set<string>;
  countVariables: Set<string>;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`\\b${escapeRe(name)}\\b`).test(text);
}

function isAddressType(type: string): boolean {
  return ADDRESS_TYPE.test(type.trim());
}

function isPendingName(name: string): boolean {
  return PENDING_NAME.test(name);
}

function isAdminName(name: string, extra: Set<string>): boolean {
  return extra.has(name) || (ADMIN_NAME.test(name) && !isPendingName(name));
}

function isAdminMappingName(name: string): boolean {
  return ADMIN_MAPPING.test(name);
}

function isRoleConstant(variable: SolStateVar, extra: Set<string>): boolean {
  return (
    /bytes32/i.test(variable.type) &&
    /ROLE/i.test(variable.name) &&
    (ROLE_ADMIN.test(variable.name) || extra.has(variable.name))
  );
}

function isCountVariable(name: string): boolean {
  return (
    /(?:admin|owner|govern|manager|controller|authority|guardian|keeper).*(?:count|num|total)|(?:count|num|total).*(?:admin|owner|govern|manager|controller|authority|guardian|keeper)/i.test(
      name,
    ) || /^_?(?:adminCount|ownerCount|governanceCount|numberOfAdmins)$/i.test(name)
  );
}

function annotationAt(source: string, offset: number, pattern: RegExp): string | undefined {
  const comment = leadingComment(source, offset);
  return pattern.test(comment) ? comment : undefined;
}

function contractDeclarationOffset(masked: string, open: number): number {
  const before = masked.slice(0, open);
  const match = /(?:abstract\s+)?contract\s+[A-Za-z_$][\w$]*[^{}]*$/.exec(before);
  return match ? match.index : open;
}

function isAbstractContract(masked: string, name: string, open: number): boolean {
  const before = masked.slice(Math.max(0, open - 500), open);
  return new RegExp(`\\babstract\\s+contract\\s+${escapeRe(name)}\\b[^{}]*$`).test(before);
}

function safeRegex(source: unknown, label: string, diagnostics: Diagnostic[]): RegExp | null {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    source.length > 120 ||
    /\([^)]*[+*][^)]*\)[+*{]/.test(source)
  ) {
    diagnostics.push({
      level: 'warning',
      code: 'invalid-option',
      message: `Ignored invalid ${label} pattern.`,
    });
    return null;
  }
  try {
    return new RegExp(source, 'i');
  } catch {
    diagnostics.push({
      level: 'warning',
      code: 'invalid-option',
      message: `Ignored invalid ${label} pattern.`,
    });
    return null;
  }
}

function identifierList(
  list: unknown,
  label: string,
  diagnostics: Diagnostic[],
): string[] {
  if (list === undefined) return [];
  if (
    !Array.isArray(list) ||
    list.some(
      (entry) => typeof entry !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(entry),
    )
  ) {
    diagnostics.push({
      level: 'warning',
      code: 'invalid-option',
      message: `Ignored invalid ${label} list.`,
    });
    return [];
  }
  return list as string[];
}

function normalizeExpression(expression: string): string {
  let value = expression.trim();
  for (;;) {
    const wrapped = /^(?:payable|address)\s*\(\s*([^()]*)\s*\)$/.exec(value);
    if (!wrapped) return value;
    value = wrapped[1].trim();
  }
}

function isZeroExpression(expression: string): boolean {
  return ZERO_EXPR.test(normalizeExpression(expression));
}

function simpleIdentifier(expression: string): string | undefined {
  const value = normalizeExpression(expression);
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : undefined;
}

function localNames(fn: SolFunction): Set<string> {
  const names = new Set(fn.params.map((parameter) => parameter.name).filter(Boolean));
  for (const statement of statementsOf(fn)) {
    const declaration =
      /^\s*(?:[A-Za-z_$][\w$]*(?:\s+payable)?)\s+(?:memory\s+|storage\s+|calldata\s+)?([A-Za-z_$][\w$]*)\s*=/.exec(
        statement.text,
      ) ??
      /(?:^|[,;(])\s*(?:[A-Za-z_$][\w$]*(?:\s+payable)?)\s+(?:memory\s+|storage\s+|calldata\s+)?([A-Za-z_$][\w$]*)\s*=/.exec(
        statement.text,
      );
    if (declaration) names.add(declaration[1]);
  }
  return names;
}

function helperAdminTarget(helper: string, adminNames: Set<string>): string | undefined {
  const suffix = /(Ownership|Owner|Admin|Governance|Governor|Manager|Controller|Authority|Guardian|Timelock|Custodian|SuperAdmin)$/.exec(
    helper,
  )?.[1];
  if (!suffix) return undefined;
  const normalized = suffix.charAt(0).toLowerCase() + suffix.slice(1);
  for (const name of adminNames) {
    if (name.toLowerCase().includes(normalized.toLowerCase())) return name;
  }
  return normalized;
}

function ownershipWrites(
  fn: SolFunction,
  adminNames: Set<string>,
  pendingNames: Set<string>,
  source: string,
): OwnershipWrite[] {
  const writes: OwnershipWrite[] = [];
  const locals = localNames(fn);
  for (const statement of statementsOf(fn, source)) {
    const direct = /^\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]+?)\s*$/.exec(
      statement.text,
    );
    if (direct && !locals.has(direct[1])) {
      const root = direct[1];
      if (adminNames.has(root) || pendingNames.has(root)) {
        writes.push({
          root,
          rhs: direct[2].trim(),
          text: statement.text,
          offset: statement.offset,
          length: statement.text.length,
          line: statement.line,
        });
      }
    }

    const deleted = /^\s*delete\s+([A-Za-z_$][\w$]*)\s*$/.exec(statement.text);
    if (deleted && !locals.has(deleted[1])) {
      const root = deleted[1];
      if (adminNames.has(root) || pendingNames.has(root)) {
        writes.push({
          root,
          rhs: 'address(0)',
          text: statement.text,
          offset: statement.offset,
          length: statement.text.length,
          line: statement.line,
        });
      }
    }

    const helperPattern =
      /\b(_transferOwnership|_setOwner|_setAdmin|_changeAdmin|_transferAdmin|_setGovernance|_transferGovernance)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = helperPattern.exec(statement.text)) !== null) {
      const open = match.index + match[0].length - 1;
      const close = findMatching(statement.text, open, '(', ')');
      if (close === -1) continue;
      const argument = splitTopLevel(
        statement.text.slice(open + 1, close),
        ',',
      )[0]?.trim();
      if (!argument) continue;
      const root = helperAdminTarget(match[1], adminNames);
      if (!root) continue;
      if (adminNames.has(root) || pendingNames.has(root) || ADMIN_LIKE.test(root)) {
        writes.push({
          root,
          rhs: argument,
          text: statement.text,
          offset: statement.offset + match.index,
          length: match[0].length + (close - open),
          line: statement.line,
          helper: match[1],
        });
      }
    }
  }
  return writes;
}

function functionText(fn: SolFunction, model: ContractModel): string {
  const modifierBodies = fn.modifiers
    .map((name) => model.modifiers.get(name)?.body ?? '')
    .join('\n');
  return `${fn.body}\n${modifierBodies}`;
}

function hasAnyAuthCheck(
  text: string,
  params: Set<string>,
): string | null {
  for (const comparand of msgSenderComparands(text)) {
    if (comparand === 'tx.origin') continue;
    const base = comparand.replace(/\(\)$/, '').split('.')[0];
    if (params.has(base)) continue;
    if (/^(?:address|this|msg|tx)$/.test(base)) continue;
    return `msg.sender compared with ${comparand}`;
  }
  if (
    /\b(?:hasRole|_checkRole|_checkOwner|isAuthorized|canCall|_authorizeCaller|_requireAuth|_requireRole|_checkRoleAdmin)\s*\(/.test(
      text,
    )
  ) {
    return 'role or owner check';
  }
  const allowList =
    /\b(?:require|if|assert)\s*\(\s*!?\s*([A-Za-z_$][\w$]*)\s*\[\s*msg\.sender\s*\]/.exec(
      text,
    );
  if (allowList) return `${allowList[1]}[msg.sender] allow-list`;
  if (/\b(?:isAdmin|isOwner|hasAdminRole|_isAdmin|_isOwner)\s*\(\s*msg\.sender/.test(text)) {
    return 'admin predicate';
  }
  return null;
}

function hasAdminCheck(
  text: string,
  params: Set<string>,
  adminNames: Set<string>,
  roleConstants: string[],
): string | null {
  for (const comparand of msgSenderComparands(text)) {
    if (comparand === 'tx.origin') continue;
    const base = comparand.replace(/\(\)$/, '').split('.')[0];
    if (params.has(base)) continue;
    if (adminNames.has(base) || (ADMIN_NAME.test(base) && !isPendingName(base))) {
      return `msg.sender compared with ${comparand}`;
    }
  }
  if (/\b_checkOwner\s*\(/.test(text)) return '_checkOwner()';
  const roleCall =
    /\b(?:hasRole|_checkRole|_checkRoleAdmin|_requireRole)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = roleCall.exec(text)) !== null) {
    const argument = match[1];
    if (
      ROLE_ADMIN.test(argument) ||
      roleConstants.some((role) => mentions(argument, role))
    ) {
      return `administrator role check (${argument.trim()})`;
    }
  }
  const allowList =
    /\b(?:require|if|assert)\s*\(\s*!?\s*([A-Za-z_$][\w$]*)\s*\[\s*msg\.sender\s*\]/.exec(
      text,
    );
  if (allowList && isAdminMappingName(allowList[1])) {
    return `${allowList[1]}[msg.sender] allow-list`;
  }
  if (/\b(?:isAdmin|isOwner|hasAdminRole|_isAdmin|_isOwner)\s*\(\s*msg\.sender/.test(text)) {
    return 'admin predicate';
  }
  return null;
}

function authEvidence(
  fn: SolFunction,
  model: ContractModel,
  adminNames: Set<string>,
  roleConstants: string[],
): AuthEvidence {
  const params = new Set(fn.params.map((parameter) => parameter.name).filter(Boolean));
  let any: string | null = null;
  let admin: string | null = null;

  for (const modifier of fn.modifiers) {
    if (NOT_ACCESS_MODIFIER.test(modifier)) continue;
    const definition = model.modifiers.get(modifier);
    if (definition) {
      const definitionParams = new Set(
        definition.params.map((parameter) => parameter.name).filter(Boolean),
      );
      const text = definition.body;
      any = any ?? hasAnyAuthCheck(text, definitionParams);
      admin = admin ?? hasAdminCheck(text, definitionParams, adminNames, roleConstants);
      continue;
    }
    if (ACCESS_MODIFIER.test(modifier)) {
      any = any ?? `modifier ${modifier} (body not visible)`;
      if (
        ADMIN_MODIFIER.test(modifier) ||
        (modifier === 'onlyRole' &&
          /onlyRole\s*\(\s*(?:DEFAULT_ADMIN_ROLE|[A-Z_]*ADMIN[A-Z_]*|[A-Z_]*GOVERN[A-Z_]*)/.test(
            fn.header,
          ))
      ) {
        admin = admin ?? `modifier ${modifier} (body not visible)`;
      }
    }
  }

  const text = fn.body;
  any = any ?? hasAnyAuthCheck(text, params);
  admin = admin ?? hasAdminCheck(text, params, adminNames, roleConstants);
  return { any, admin };
}

function pendingAuthEvidence(
  fn: SolFunction,
  model: ContractModel,
  pendingName: string,
): string | null {
  const name = escapeRe(pendingName);
  const texts = [
    fn.body,
    ...fn.modifiers.map((modifier) => model.modifiers.get(modifier)?.body ?? ''),
  ];
  for (const text of texts) {
    if (
      new RegExp(
        `msg\\.sender\\s*[!=]=\\s*(?:address\\s*\\(\\s*)?${name}\\b|\\b${name}\\b\\s*[!=]=\\s*msg\\.sender`,
      ).test(text)
    ) {
      return `msg.sender compared with ${pendingName}`;
    }
    if (new RegExp(`\\b(?:check|require|validate)Pending\\w*\\s*\\(`, 'i').test(text)) {
      return `pending-owner check helper`;
    }
  }
  return null;
}

function validatesNonZero(
  fn: SolFunction,
  model: ContractModel,
  name: string,
): boolean {
  if (!name || name === 'msg.sender') return true;
  if (isZeroExpression(name)) return false;
  const escaped = escapeRe(name);
  const texts = [
    fn.body,
    ...fn.modifiers.map((modifier) => model.modifiers.get(modifier)?.body ?? ''),
  ];
  for (const text of texts) {
    if (
      new RegExp(
        `\\b${escaped}\\b\\s*!=\\s*(?:address\\s*\\(\\s*0\\s*\\)|0x0+\\b|0\\b)|(?:address\\s*\\(\\s*0\\s*\\)|0x0+\\b|0\\b)\\s*!=\\s*\\b${escaped}\\b`,
      ).test(text)
    ) {
      return true;
    }
    if (
      new RegExp(
        `if\\s*\\(\\s*\\b${escaped}\\b\\s*==\\s*(?:address\\s*\\(\\s*0\\s*\\)|0x0+\\b|0\\b)\\s*\\)\\s*(?:\\{\\s*)?(?:revert|throw)`,
      ).test(text)
    ) {
      return true;
    }
    if (
      new RegExp(
        `\\b(?:nonZero|notZero|validAddress|checkAddress|_checkNonZero|_requireNonZero|requireNonZero|_validateAddress)\\s*\\(\\s*${escaped}\\s*\\)`,
      ).test(text)
    ) {
      return true;
    }
    if (
      new RegExp(
        `\\b${escaped}\\b\\s*\\.\\s*code\\s*\\.\\s*length|\\b(?:isContract|extcodesize)\\s*\\(\\s*${escaped}\\s*\\)`,
      ).test(text)
    ) {
      return true;
    }
  }
  return false;
}

function zeroAllowedFor(
  fn: SolFunction,
  model: ContractModel,
  expression: string,
): boolean {
  if (isZeroExpression(expression)) return true;
  if (DEFINITELY_NONZERO.test(normalizeExpression(expression))) return false;
  const identifier = simpleIdentifier(expression);
  if (identifier) return !validatesNonZero(fn, model, identifier);
  return true;
}

function clearsPending(
  reachable: SolFunction[],
  pendingNames: Set<string>,
  source: string,
): boolean {
  for (const fn of reachable) {
    for (const write of ownershipWrites(fn, new Set(), pendingNames, source)) {
      if (pendingNames.has(write.root) && isZeroExpression(write.rhs)) return true;
    }
  }
  return false;
}

function lastAdminGuard(
  text: string,
  roleExpression: string,
  countVariables: Set<string>,
): string | null {
  const role = roleExpression.trim();
  if (role) {
    const escaped = escapeRe(role);
    if (
      new RegExp(
        `getRoleMemberCount\\s*\\(\\s*${escaped}\\s*\\)\\s*(?:>\\s*1|>=\\s*2|!=\\s*1)`,
      ).test(text)
    ) {
      return `getRoleMemberCount(${role}) proves another member remains`;
    }
    if (
      new RegExp(
        `getRoleMemberCount\\s*\\(\\s*${escaped}\\s*\\)\\s*<=\\s*1[\\s\\S]{0,120}revert`,
      ).test(text)
    ) {
      return `getRoleMemberCount(${role}) <= 1 reverts`;
    }
    if (
      new RegExp(
        `roleMemberCount\\s*\\[\\s*${escaped}\\s*\\]\\s*(?:>\\s*1|>=\\s*2|!=\\s*1)`,
      ).test(text)
    ) {
      return `roleMemberCount[${role}] proves another member remains`;
    }
  }
  for (const variable of countVariables) {
    const escaped = escapeRe(variable);
    if (
      new RegExp(
        `\\b${escaped}\\b\\s*(?:>\\s*1|>=\\s*2|!=\\s*1)|if\\s*\\(\\s*\\b${escaped}\\b\\s*<=\\s*1\\s*\\)\\s*(?:\\{\\s*)?revert`,
      ).test(text)
    ) {
      return `${variable} proves another administrator remains`;
    }
  }
  return null;
}

function rejectsAdminRole(text: string): boolean {
  return ROLE_REJECT.test(text);
}

function reachableFunctions(
  model: ContractModel,
  entry: SolFunction,
): SolFunction[] {
  const result: SolFunction[] = [];
  const seen = new Set<SolFunction>();
  const queue: Array<{ fn: SolFunction; depth: number }> = [
    { fn: entry, depth: 0 },
  ];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.fn) || !current.fn.hasBody) continue;
    seen.add(current.fn);
    result.push(current.fn);
    if (current.depth >= 4) continue;
    for (const callee of calleesOf(model, current.fn)) {
      if (callee.hasBody && callee.kind !== 'constructor') {
        queue.push({ fn: callee, depth: current.depth + 1 });
      }
    }
  }
  return result;
}

function findingConfidence(
  severity: SecurityFinding['severity'],
): SecurityFinding['confidence'] {
  if (severity === 'critical' || severity === 'high') return 'high';
  return 'medium';
}

function rationale(kind: string): string {
  switch (kind) {
    case 'unprotected-ownership-transfer':
      return 'Any caller can replace the administrator, so an attacker can take control or lock the legitimate administrator out.';
    case 'unprotected-acceptance':
      return 'Any caller can finalize a staged ownership transfer, allowing front-running or theft of administrative control.';
    case 'unprotected-renunciation':
      return 'Any caller can remove the administrator, permanently disabling every function that depends on that privilege.';
    case 'unprotected-role-revocation':
      return 'Any caller can revoke administrator roles, allowing an attacker to remove all recovery paths.';
    case 'renounce-lockout':
      return 'Renouncing the final administrator removes the only authority for privileged maintenance, recovery, or upgrade functions.';
    case 'last-admin-revocation':
      return 'Revoking the final administrator can leave role-gated recovery and configuration functions permanently unreachable.';
    case 'last-admin-renunciation':
      return 'An administrator renouncing the final administrator role can leave role-gated recovery and configuration functions permanently unreachable.';
    case 'pending-owner-zero':
      return 'A zero pending owner cannot accept ownership, so the transfer cannot complete and administrative recovery is stranded.';
    case 'acceptance-not-pending-owner':
      return 'Acceptance that is not bound to the pending owner lets the current administrator finalize without the nominee, defeating the consent step.';
    case 'pending-owner-not-cleared':
      return 'A stale pending owner can accept again after ownership changes, allowing a previous nominee to reclaim control.';
    case 'missing-acceptance':
      return 'Staging an owner without an acceptance path makes the transfer incomplete and can strand administrative control.';
    case 'broken-two-step-transfer':
      return 'A direct assignment bypasses the pending-owner consent step, so a typo or compromised key can transfer control irreversibly.';
    case 'ownership-transfer-to-zero':
      return 'Assigning address(0) removes the administrator and permanently locks privileged functionality.';
    default:
      return 'A direct ownership transfer has no acceptance step, so a mistaken address permanently loses administrative control.';
  }
}

function remediation(kind: string): string {
  switch (kind) {
    case 'one-step-ownership-transfer':
    case 'broken-two-step-transfer':
    case 'missing-acceptance':
      return 'Use a two-step flow: store a pending owner, require the nominee to call acceptOwnership(), and only then assign the owner and clear the pending value. OpenZeppelin Ownable2Step implements this pattern.';
    case 'ownership-transfer-to-zero':
      return 'Reject address(0) before assigning an administrator address, and make renunciation a separate explicit function with documented consequences.';
    case 'pending-owner-zero':
      return 'Reject address(0) when staging a pending owner, and require the pending value to be non-zero before acceptance.';
    case 'unprotected-ownership-transfer':
      return 'Restrict ownership transfers to the current owner or an administrator role, for example with onlyOwner or onlyRole(DEFAULT_ADMIN_ROLE).';
    case 'unprotected-acceptance':
      return 'Require msg.sender to equal the pending owner in the acceptance function.';
    case 'acceptance-not-pending-owner':
      return 'Bind acceptance to the pending owner: require(msg.sender == pendingOwner) (or the equivalent role check) and do not let the current owner finalize unilaterally.';
    case 'pending-owner-not-cleared':
      return 'Clear the pending owner after acceptance (delete pendingOwner or set it to address(0)).';
    case 'renounce-lockout':
      return 'Remove the renunciation path, require a replacement administrator or multi-signature recovery, or override renounceOwnership() to revert when the contract is intentionally immutable.';
    case 'unprotected-renunciation':
      return 'Restrict renunciation to the current administrator and require a documented recovery or replacement path before removing the final administrator.';
    case 'last-admin-revocation':
      return 'Before revoking an administrator role, require another administrator to remain, for example require(getRoleMemberCount(role) > 1) with AccessControlEnumerable, or track an administrator count.';
    case 'last-admin-renunciation':
      return 'Prevent the final administrator from renouncing: require another administrator to remain or require a replacement to be appointed first.';
    case 'unprotected-role-revocation':
      return 'Restrict role revocation to an administrator role and require another administrator to remain.';
    default:
      return 'Review the ownership and role administration flow and preserve an independent recovery path.';
  }
}

function findingFor(
  context: AnalysisContext,
  fn: SolFunction,
  kind: string,
  severity: SecurityFinding['severity'],
  offset: number,
  length: number,
  message: string,
  evidence: string[],
  details: Record<string, unknown>,
): SecurityFinding {
  return makeFinding(context.source, offset, {
    ruleId: RULE_ID,
    kind,
    severity,
    confidence: findingConfidence(severity),
    contract: context.model.contract.name,
    function: fn.name,
    message,
    severityRationale: rationale(kind),
    confidenceEvidence: evidence,
    remediation: remediation(kind),
    details: {
      ...details,
      statementLength: length,
      confidence: CONFIDENCE_VALUE[findingConfidence(severity)],
    },
  });
}

export function detectOwnershipLockout(
  input: unknown,
  options: OwnershipLockoutOptions = {},
): OwnershipLockoutResult {
  const prep = prepareSource(input);
  if (!prep.ok) {
    return {
      ruleId: RULE_ID,
      analyzed: false,
      findings: [],
      diagnostics: prep.diagnostics,
      flows: [],
      contracts: [],
    };
  }

  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const exemptContracts = new Set(
    identifierList(options.exemptContracts, 'exemptContracts', diagnostics),
  );
  const exemptFunctions = new Set(
    identifierList(options.exemptFunctions, 'exemptFunctions', diagnostics),
  );
  const extraAdminVariables = new Set(
    identifierList(options.adminVariables, 'adminVariables', diagnostics),
  );
  const extraAdminRoles = new Set(
    identifierList(options.adminRoles, 'adminRoles', diagnostics),
  );
  const exemptPatterns = (options.exemptPatterns ?? [])
    .map((pattern) => safeRegex(pattern, 'exemptPatterns', diagnostics))
    .filter((pattern): pattern is RegExp => pattern !== null);
  const includeOneStepTransfers = options.includeOneStepTransfers !== false;

  const model = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const flows: OwnershipFlow[] = [];
  const contracts: OwnershipContractEntry[] = [];
  const seen = new Set<string>();

  const pushFinding = (
    context: AnalysisContext,
    fn: SolFunction,
    kind: string,
    severity: SecurityFinding['severity'],
    offset: number,
    length: number,
    message: string,
    evidence: string[],
    details: Record<string, unknown>,
    flow: OwnershipFlow,
  ) => {
    const key = `${context.model.contract.name}:${fn.name}:${kind}:${offset}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(
      findingFor(context, fn, kind, severity, offset, length, message, evidence, details),
    );
    flows.push(flow);
  };

  for (const contractModel of model.contracts.values()) {
    if (
      !contractModel.isLeaf ||
      contractModel.contract.kind !== 'contract' ||
      isAbstractContract(masked, contractModel.contract.name, contractModel.contract.open)
    ) {
      continue;
    }

    const contractName = contractModel.contract.name;
    const findingsStart = findings.length;
    const declarationOffset = contractDeclarationOffset(
      masked,
      contractModel.contract.open,
    );
    const contractAnnotation = annotationAt(
      source,
      declarationOffset,
      CONTRACT_ANNOTATION,
    );
    const configuredExempt =
      exemptContracts.has(contractName) ||
      exemptPatterns.some((pattern) => pattern.test(contractName));
    const allAdminVariables = contractModel.stateVars.filter(
      (variable) =>
        isAddressType(variable.type) &&
        isAdminName(variable.name, extraAdminVariables) &&
        !isPendingName(variable.name),
    );
    const adminVariables = allAdminVariables.filter(
      (variable) => !variable.constant && !variable.immutable,
    );
    const pendingVariables = contractModel.stateVars.filter(
      (variable) => isAddressType(variable.type) && isPendingName(variable.name),
    );
    const roleConstants = contractModel.stateVars
      .filter((variable) => isRoleConstant(variable, extraAdminRoles))
      .map((variable) => variable.name);
    const adminMappings = new Set(
      contractModel.stateVars
        .filter(
          (variable) =>
            /^mapping\s*\(/.test(variable.type) &&
            isAdminMappingName(variable.name),
        )
        .map((variable) => variable.name),
    );
    const countVariables = new Set(
      contractModel.stateVars
        .filter((variable) => isCountVariable(variable.name))
        .map((variable) => variable.name),
    );

    const unresolvedOwnable = contractModel.unresolvedBases.some((base) =>
      /Ownable|AccessControl/i.test(base),
    );
    const unresolvedAccessControl = contractModel.unresolvedBases.some((base) =>
      /AccessControl/i.test(base),
    );
    const adminNames = new Set(adminVariables.map((variable) => variable.name));
    if (unresolvedOwnable && adminNames.size === 0) {
      adminNames.add('owner');
    }
    if (unresolvedAccessControl && roleConstants.length === 0) {
      roleConstants.push('DEFAULT_ADMIN_ROLE');
    }

    const context: AnalysisContext = {
      source,
      model: contractModel,
      adminNames,
      pendingNames: new Set(pendingVariables.map((variable) => variable.name)),
      roleConstants,
      adminMappings,
      countVariables,
    };

    const entryPoints = contractModel.functions.filter(
      (fn) =>
        fn.kind === 'function' &&
        fn.hasBody &&
        (fn.visibility === 'public' || fn.visibility === 'external'),
    );
    const adminFunctions = entryPoints.filter(
      (fn) => authEvidence(fn, contractModel, adminNames, roleConstants).admin !== null,
    );
    const roleSurface =
      roleConstants.length > 0 ||
      adminMappings.size > 0 ||
      contractModel.functions.some((fn) =>
        /\b(?:_?grantRole|_?revokeRole|_?renounceRole|hasRole|_checkRole)\s*\(/.test(
          fn.body,
        ),
      ) ||
      unresolvedAccessControl;
    const ownershipChangeFunctions = entryPoints.filter(
      (fn) =>
        TRANSFER_FN.test(fn.name) ||
        ACCEPT_FN.test(fn.name) ||
        RENOUNCE_FN.test(fn.name),
    );
    const recoverySurface = adminFunctions.filter(
      (fn) =>
        !TRANSFER_FN.test(fn.name) &&
        !ACCEPT_FN.test(fn.name) &&
        !RENOUNCE_FN.test(fn.name),
    );

    let status: OwnershipStatus = 'risk';
    let reason = '';
    if (contractAnnotation || configuredExempt) {
      status = 'exempt';
      reason = 'documented exemption';
    } else if (
      allAdminVariables.length === 0 &&
      adminFunctions.length === 0 &&
      !roleSurface
    ) {
      status = 'permissionless';
      reason = 'no administrator or role-gated functionality';
    } else if (
      allAdminVariables.length > 0 &&
      allAdminVariables.every((variable) => variable.constant || variable.immutable) &&
      ownershipChangeFunctions.length === 0 &&
      !roleSurface
    ) {
      status = 'immutable';
      reason = 'administrator address is immutable or constant with no transfer or renounce path';
    } else if (adminFunctions.length === 0 && !roleSurface && adminVariables.length > 0) {
      status = 'permissionless';
      reason = 'administrator variables are not used as an authorization boundary';
    } else {
      reason =
        recoverySurface.length > 0
          ? `${recoverySurface.length} privileged function(s) depend on the administrator`
          : 'administrator or role management is present';
    }

    const contractEntry: OwnershipContractEntry = {
      contract: contractName,
      line: lineColumn(source, declarationOffset).line,
      status,
      adminVariables: allAdminVariables.map((variable) => variable.name),
      pendingVariables: pendingVariables.map((variable) => variable.name),
      adminFunctions: adminFunctions.map((fn) => fn.name),
      reason,
    };
    contracts.push(contractEntry);

    if (status !== 'risk') continue;

    for (const entry of entryPoints) {
      if (
        exemptFunctions.has(entry.name) ||
        exemptPatterns.some((pattern) => pattern.test(entry.name)) ||
        annotationAt(source, entry.offset, FUNCTION_ANNOTATION)
      ) {
        continue;
      }
      const entryAuth = authEvidence(
        entry,
        contractModel,
        adminNames,
        roleConstants,
      );
      const reachable = reachableFunctions(contractModel, entry);
      const reachableText = reachable
        .map((fn) => functionText(fn, contractModel))
        .join('\n');
      const isTransfer = TRANSFER_FN.test(entry.name);
      const isAccept = ACCEPT_FN.test(entry.name);
      const isRenounce = RENOUNCE_FN.test(entry.name);

      for (const fn of reachable) {
        const fnAuth = authEvidence(fn, contractModel, adminNames, roleConstants);
        const restricted = Boolean(entryAuth.any || fnAuth.any);
        const adminRestricted = Boolean(entryAuth.admin || fnAuth.admin);
        const writes = ownershipWrites(
          fn,
          adminNames,
          context.pendingNames,
          source,
        );

        for (const write of writes) {
          if (context.pendingNames.has(write.root)) {
            if (
              !isZeroExpression(write.rhs) &&
              zeroAllowedFor(fn, contractModel, write.rhs)
            ) {
              pushFinding(
                context,
                fn,
                'pending-owner-zero',
                'high',
                write.offset,
                write.length,
                `${entry.name} stages '${write.root}' from '${write.rhs}' without rejecting address(0); a zero pending owner cannot complete the transfer.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  `No zero-address check for '${write.rhs}' was found in the function or its modifiers.`,
                ],
                {
                  admin: write.root,
                  pending: write.root,
                  expression: write.rhs,
                  entryPoint: entry.name,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'pending-owner-zero',
                  status: 'risk',
                  pending: write.root,
                  reason: 'pending owner can be address(0)',
                },
              );
            }
            if (!restricted) {
              pushFinding(
                context,
                fn,
                'unprotected-ownership-transfer',
                'critical',
                write.offset,
                write.length,
                `${entry.name} stages a new owner without a recognized authorization check, so any caller can start an ownership transfer.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  'No effective msg.sender, role, or owner check was found on the entry point or its modifiers.',
                ],
                {
                  admin: write.root,
                  pending: write.root,
                  entryPoint: entry.name,
                  auth: null,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'unprotected-ownership-transfer',
                  status: 'risk',
                  pending: write.root,
                },
              );
            }
            continue;
          }

          if (!adminNames.has(write.root)) continue;

          const zeroAllowed = zeroAllowedFor(fn, contractModel, write.rhs);

          if (isRenounce) {
            if (ALWAYS_REVERTS.test(fn.body.trim())) {
              flows.push({
                contract: contractName,
                function: entry.name,
                line: write.line,
                kind: 'renounce-lockout',
                status: 'exempt',
                admin: write.root,
                reason: 'renunciation always reverts',
              });
              continue;
            }
            if (recoverySurface.length === 0) {
              flows.push({
                contract: contractName,
                function: entry.name,
                line: write.line,
                kind: 'renounce-lockout',
                status: 'safe',
                admin: write.root,
                reason: 'no privileged function depends on the administrator',
              });
              continue;
            }
            const kind = restricted
              ? 'renounce-lockout'
              : 'unprotected-renunciation';
            pushFinding(
              context,
              fn,
              kind,
              restricted ? 'high' : 'critical',
              write.offset,
              write.length,
              restricted
                ? `${entry.name} permanently removes '${write.root}' while ${recoverySurface.length} privileged function(s) still depend on it.`
                : `${entry.name} can remove '${write.root}' without authorization, permanently locking privileged functionality.`,
              [
                `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                restricted
                  ? `Authorization evidence: ${entryAuth.any ?? fnAuth.any}.`
                  : 'No effective authorization check was found.',
                `${recoverySurface.length} privileged function(s) remain: ${recoverySurface
                  .map((item) => item.name)
                  .join(', ')}.`,
              ],
              {
                admin: write.root,
                entryPoint: entry.name,
                recoveryFunctions: recoverySurface.map((item) => item.name),
                auth: entryAuth.any ?? fnAuth.any,
              },
              {
                contract: contractName,
                function: entry.name,
                line: write.line,
                kind,
                status: 'risk',
                admin: write.root,
                reason: 'administrator removal disables privileged functions',
              },
            );
            continue;
          }

          if (isAccept) {
            const pendingName =
              context.pendingNames.size === 1
                ? [...context.pendingNames][0]
                : write.root;
            const pendingAuth = pendingAuthEvidence(
              entry,
              contractModel,
              pendingName,
            );
            if (!restricted) {
              pushFinding(
                context,
                fn,
                'unprotected-acceptance',
                'critical',
                write.offset,
                write.length,
                `${entry.name} accepts ownership without authenticating the pending owner.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  'No effective authorization check was found.',
                ],
                {
                  admin: write.root,
                  pending: pendingName,
                  entryPoint: entry.name,
                  auth: null,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'unprotected-acceptance',
                  status: 'risk',
                  admin: write.root,
                  pending: pendingName,
                },
              );
            } else if (context.pendingNames.size > 0 && !pendingAuth) {
              pushFinding(
                context,
                fn,
                'acceptance-not-pending-owner',
                'high',
                write.offset,
                write.length,
                `${entry.name} accepts ownership without requiring msg.sender to be '${pendingName}'.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  `Authorization evidence: ${entryAuth.any ?? fnAuth.any}.`,
                  `No comparison between msg.sender and '${pendingName}' was found.`,
                ],
                {
                  admin: write.root,
                  pending: pendingName,
                  entryPoint: entry.name,
                  auth: entryAuth.any ?? fnAuth.any,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'acceptance-not-pending-owner',
                  status: 'risk',
                  admin: write.root,
                  pending: pendingName,
                },
              );
            }
            if (
              context.pendingNames.size > 0 &&
              !clearsPending(reachable, context.pendingNames, source)
            ) {
              pushFinding(
                context,
                fn,
                'pending-owner-not-cleared',
                'medium',
                write.offset,
                write.length,
                `${entry.name} does not clear '${pendingName}' after acceptance, leaving a stale pending owner.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  `No write of address(0) to '${pendingName}' was found on the acceptance path.`,
                ],
                {
                  admin: write.root,
                  pending: pendingName,
                  entryPoint: entry.name,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'pending-owner-not-cleared',
                  status: 'risk',
                  admin: write.root,
                  pending: pendingName,
                },
              );
            }
            continue;
          }

          if (isTransfer || adminRestricted) {
            if (context.pendingNames.size > 0) {
              pushFinding(
                context,
                fn,
                'broken-two-step-transfer',
                'high',
                write.offset,
                write.length,
                `${entry.name} writes '${write.root}' directly even though a pending-owner variable exists, bypassing the acceptance step.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  `Pending variables: ${[...context.pendingNames].join(', ')}.`,
                ],
                {
                  admin: write.root,
                  pending: [...context.pendingNames],
                  entryPoint: entry.name,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'broken-two-step-transfer',
                  status: 'risk',
                  admin: write.root,
                },
              );
              continue;
            }

            if (!restricted) {
              pushFinding(
                context,
                fn,
                'unprotected-ownership-transfer',
                'critical',
                write.offset,
                write.length,
                `${entry.name} changes ownership without a recognized authorization check.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  'No effective msg.sender, role, or owner check was found.',
                ],
                {
                  admin: write.root,
                  entryPoint: entry.name,
                  auth: null,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'unprotected-ownership-transfer',
                  status: 'risk',
                  admin: write.root,
                },
              );
              continue;
            }

            if (includeOneStepTransfers) {
              pushFinding(
                context,
                fn,
                'one-step-ownership-transfer',
                zeroAllowed ? 'high' : 'medium',
                write.offset,
                write.length,
                zeroAllowed
                  ? `${entry.name} transfers '${write.root}' directly to '${write.rhs}' without a pending-owner acceptance step and without rejecting address(0).`
                  : `${entry.name} transfers '${write.root}' directly to '${write.rhs}' without a pending-owner acceptance step.`,
                [
                  `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                  zeroAllowed
                    ? `No zero-address check for '${write.rhs}' was found.`
                    : `'${write.rhs}' is checked against address(0).`,
                  'No pending-owner acceptance flow exists in the contract.',
                ],
                {
                  admin: write.root,
                  expression: write.rhs,
                  zeroCheck: !zeroAllowed,
                  entryPoint: entry.name,
                  auth: entryAuth.any ?? fnAuth.any,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: write.line,
                  kind: 'one-step-ownership-transfer',
                  status: 'risk',
                  admin: write.root,
                  reason: zeroAllowed
                    ? 'direct transfer without acceptance or zero-address guard'
                    : 'direct transfer without acceptance',
                },
              );
            }
            continue;
          }

          if (zeroAllowed) {
            pushFinding(
              context,
              fn,
              'ownership-transfer-to-zero',
              'high',
              write.offset,
              write.length,
              `${entry.name} can assign address(0) to '${write.root}' without a zero-address guard.`,
              [
                `'${entry.name}' writes '${write.root}' in '${write.text}'.`,
                `No zero-address check for '${write.rhs}' was found.`,
              ],
              {
                admin: write.root,
                expression: write.rhs,
                entryPoint: entry.name,
              },
              {
                contract: contractName,
                function: entry.name,
                line: write.line,
                kind: 'ownership-transfer-to-zero',
                status: 'risk',
                admin: write.root,
              },
            );
          }
        }
      }

      if (isAccept && context.pendingNames.size > 0) {
        const acceptsAdmin = reachable.some((fn) =>
          ownershipWrites(fn, adminNames, context.pendingNames, source).some(
            (write) => adminNames.has(write.root),
          ),
        );
        if (!acceptsAdmin) {
          const firstPending = [...context.pendingNames][0];
          pushFinding(
            context,
            entry,
            'broken-two-step-transfer',
            'high',
            entry.offset,
            entry.name.length,
            `${entry.name} does not assign the pending owner to '${[...adminNames][0] ?? 'owner'}', so the staged transfer never completes.`,
            [
              `'${entry.name}' was recognized as an acceptance function.`,
              `No assignment to an administrator variable was found on its call path.`,
              `Pending variable: '${firstPending}'.`,
            ],
            {
              pending: firstPending,
              entryPoint: entry.name,
            },
            {
              contract: contractName,
              function: entry.name,
              line: entry.line,
              kind: 'broken-two-step-transfer',
              status: 'risk',
              pending: firstPending,
            },
          );
        }
      }

      if (isTransfer && context.pendingNames.size > 0) {
        const stagesPending = reachable.some((fn) =>
          ownershipWrites(fn, adminNames, context.pendingNames, source).some(
            (write) => context.pendingNames.has(write.root),
          ),
        );
        const acceptanceExists = entryPoints.some((fn) => ACCEPT_FN.test(fn.name));
        if (stagesPending && !acceptanceExists) {
          const firstPending = [...context.pendingNames][0];
          pushFinding(
            context,
            entry,
            'missing-acceptance',
            'high',
            entry.offset,
            entry.name.length,
            `${entry.name} stages '${firstPending}' but no acceptance function completes the transfer.`,
            [
              `'${entry.name}' writes a pending-owner variable.`,
              'No accept/claim/complete ownership function was found in the contract.',
            ],
            {
              pending: firstPending,
              entryPoint: entry.name,
            },
            {
              contract: contractName,
              function: entry.name,
              line: entry.line,
              kind: 'missing-acceptance',
              status: 'risk',
              pending: firstPending,
            },
          );
        }
      }
    }

    for (const entry of entryPoints) {
      if (
        exemptFunctions.has(entry.name) ||
        exemptPatterns.some((pattern) => pattern.test(entry.name)) ||
        annotationAt(source, entry.offset, FUNCTION_ANNOTATION)
      ) {
        continue;
      }
      const entryAuth = authEvidence(
        entry,
        contractModel,
        adminNames,
        roleConstants,
      );
      const reachable = reachableFunctions(contractModel, entry);
      const reachableText = reachable
        .map((fn) => functionText(fn, contractModel))
        .join('\n');
      const isRenounceRole = /renounceRole/i.test(entry.name);

      for (const fn of reachable) {
        const fnAuth = authEvidence(fn, contractModel, adminNames, roleConstants);
        const restricted = Boolean(entryAuth.any || fnAuth.any);
        const isRenounceFunction = /renounce/i.test(fn.name) || /renounce/i.test(entry.name);

        for (const statement of statementsOf(fn, source)) {
          const roleCall =
            /\b(_?revokeRole|_?renounceRole|_?removeRole|_?revokeAdmin|_?removeAdmin|_?revokeGovernor|_?removeGovernor)\s*\(/g;
          let match: RegExpExecArray | null;
          while ((match = roleCall.exec(statement.text)) !== null) {
            const open = match.index + match[0].length - 1;
            const close = findMatching(statement.text, open, '(', ')');
            if (close === -1) continue;
            const args = splitTopLevel(statement.text.slice(open + 1, close), ',');
            const roleExpression = args[0]?.trim() ?? '';
            const accountExpression = args[1]?.trim() ?? '';
            const roleIsAdmin =
              ROLE_ADMIN.test(roleExpression) ||
              roleConstants.some((role) => mentions(roleExpression, role)) ||
              (fn.params.some((parameter) => parameter.name === roleExpression) &&
                /revokeRole|renounceRole/i.test(match[1]));
            if (!roleIsAdmin) continue;
            if (rejectsAdminRole(reachableText)) continue;
            const guard = lastAdminGuard(
              reachableText,
              roleExpression,
              countVariables,
            );
            const selfRenounce =
              isRenounceFunction ||
              isRenounceRole ||
              /msg\.sender/.test(accountExpression);
            if (!restricted) {
              const kind = selfRenounce
                ? 'last-admin-renunciation'
                : 'unprotected-role-revocation';
              pushFinding(
                context,
                fn,
                kind,
                selfRenounce ? 'high' : 'critical',
                statement.offset + match.index,
                match[0].length + (close - open),
                selfRenounce
                  ? `${entry.name} can remove the caller's administrator role without authorization or a last-admin guard.`
                  : `${entry.name} can revoke administrator roles without authorization.`,
                [
                  `'${fn.name}' calls '${match[1]}(${roleExpression}, ${accountExpression})'.`,
                  restricted
                    ? `Authorization evidence: ${entryAuth.any ?? fnAuth.any}.`
                    : 'No effective authorization check was found.',
                  guard
                    ? `Last-admin guard: ${guard}.`
                    : 'No guard proves another administrator remains.',
                ],
                {
                  role: roleExpression,
                  account: accountExpression,
                  guard,
                  entryPoint: entry.name,
                  auth: entryAuth.any ?? fnAuth.any,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: statement.line,
                  kind,
                  status: 'risk',
                  role: roleExpression,
                },
              );
            } else if (!guard) {
              const kind = selfRenounce
                ? 'last-admin-renunciation'
                : 'last-admin-revocation';
              pushFinding(
                context,
                fn,
                kind,
                'high',
                statement.offset + match.index,
                match[0].length + (close - open),
                selfRenounce
                  ? `${entry.name} lets an administrator renounce their own role without proving another administrator remains.`
                  : `${entry.name} revokes an administrator role without proving another administrator remains.`,
                [
                  `'${fn.name}' calls '${match[1]}(${roleExpression}, ${accountExpression})'.`,
                  `Authorization evidence: ${entryAuth.any ?? fnAuth.any}.`,
                  'No getRoleMemberCount(...) > 1 or administrator-count guard was found.',
                ],
                {
                  role: roleExpression,
                  account: accountExpression,
                  guard: null,
                  entryPoint: entry.name,
                  auth: entryAuth.any ?? fnAuth.any,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: statement.line,
                  kind,
                  status: 'risk',
                  role: roleExpression,
                },
              );
            }
          }

          const mappingRemoval =
            /^\s*(?:delete\s+([A-Za-z_$][\w$]*)\s*\[([^\]]+)\]|([A-Za-z_$][\w$]*)\s*\[([^\]]+)\]\s*=\s*(false|0))\s*$/.exec(
              statement.text,
            );
          if (mappingRemoval) {
            const mapping = mappingRemoval[1] ?? mappingRemoval[3];
            const account = mappingRemoval[2] ?? mappingRemoval[4];
            if (!adminMappings.has(mapping)) continue;
            const guard = lastAdminGuard(reachableText, '', countVariables);
            const selfRenounce =
              isRenounceFunction || /msg\.sender/.test(account);
            if (!restricted) {
              const kind = selfRenounce
                ? 'last-admin-renunciation'
                : 'unprotected-role-revocation';
              pushFinding(
                context,
                fn,
                kind,
                selfRenounce ? 'high' : 'critical',
                statement.offset,
                statement.text.length,
                selfRenounce
                  ? `${entry.name} can remove the caller's administrator flag without authorization or a last-admin guard.`
                  : `${entry.name} can remove administrator flags without authorization.`,
                [
                  `'${fn.name}' removes '${account}' from '${mapping}'.`,
                  'No effective authorization check was found.',
                  guard
                    ? `Last-admin guard: ${guard}.`
                    : 'No administrator-count guard proves another administrator remains.',
                ],
                {
                  mapping,
                  account,
                  guard,
                  entryPoint: entry.name,
                  auth: entryAuth.any ?? fnAuth.any,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: statement.line,
                  kind,
                  status: 'risk',
                },
              );
            } else if (!guard) {
              const kind = selfRenounce
                ? 'last-admin-renunciation'
                : 'last-admin-revocation';
              pushFinding(
                context,
                fn,
                kind,
                'high',
                statement.offset,
                statement.text.length,
                selfRenounce
                  ? `${entry.name} lets an administrator remove their own flag without proving another administrator remains.`
                  : `${entry.name} removes an administrator flag without proving another administrator remains.`,
                [
                  `'${fn.name}' removes '${account}' from '${mapping}'.`,
                  `Authorization evidence: ${entryAuth.any ?? fnAuth.any}.`,
                  'No administrator-count guard was found.',
                ],
                {
                  mapping,
                  account,
                  guard: null,
                  entryPoint: entry.name,
                  auth: entryAuth.any ?? fnAuth.any,
                },
                {
                  contract: contractName,
                  function: entry.name,
                  line: statement.line,
                  kind,
                  status: 'risk',
                },
              );
            }
          }
        }
      }
    }

    if (status === 'risk' && findings.length === findingsStart) {
      contractEntry.status = 'safe';
      contractEntry.reason = 'no ownership or last-admin lockout flow detected';
    }
  }

  return {
    ruleId: RULE_ID,
    analyzed: true,
    findings,
    diagnostics,
    flows,
    contracts,
  };
}
