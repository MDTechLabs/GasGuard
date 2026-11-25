import { createHash } from "crypto";
import {
  extractCallables,
  findMatchingClose,
  FunctionModel,
  lineAndColumn,
  prepareSoliditySource,
  splitTopLevelArguments,
} from "./solidity-source-utils";

export const ROLE_ADMIN_RULE_ID = "sol-027";
export const ROLE_ADMIN_VALIDATOR_VERSION = "1.0.0";

export const DEFAULT_MAX_SOURCE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_CONTRACTS = 128;
export const DEFAULT_MAX_GRAPH_NODES = 256;
export const DEFAULT_MAX_GRAPH_EDGES = 512;
export const DEFAULT_MAX_DFS_DEPTH = 32;

export type RoleAdminIssueType =
  | "privilege-escalation-edge"
  | "transitive-admin-escalation"
  | "role-admin-cycle"
  | "unprotected-role-admin-mutation";

export type RoleTier = 1 | 2 | 3 | 4;

export interface RoleAdminGraphOptions {
  maxSourceBytes?: number;
  maxContracts?: number;
  maxGraphNodes?: number;
  maxGraphEdges?: number;
  maxDfsDepth?: number;
  extraPrivilegedRoles?: string[];
  allowedAdminEdges?: Array<{ role: string; adminRole: string }>;
}

export interface RoleAdminEdge {
  contractName: string;
  functionName: string;
  role: string;
  adminRole: string;
  line: number;
  startColumn: number;
  endColumn: number;
  viaHelper?: string;
}

export interface RoleAdminFinding {
  ruleId: typeof ROLE_ADMIN_RULE_ID;
  issueType: RoleAdminIssueType;
  contractName: string;
  functionName: string;
  role: string;
  adminRole: string;
  escalationPath: string[];
  line: number;
  startColumn: number;
  endColumn: number;
  confidence: number;
  evidence: string[];
  impact: string;
  remediation: string;
  severityRationale: string;
}

export interface RoleAdminToolchainMetadata {
  analyzer: "RoleAdminGraphValidator";
  validatorVersion: string;
  pragmaSolidity: string | null;
  analysisMode: "static-source-pattern";
  executesRepoCode: false;
}

export interface RoleAdminGraphReport {
  findings: RoleAdminFinding[];
  diagnostics: string[];
  graph: {
    nodes: string[];
    edges: RoleAdminEdge[];
  };
  toolchain: RoleAdminToolchainMetadata;
  inputDigest: string;
}

interface ContractBlock {
  kind: "contract" | "library" | "interface";
  name: string;
  start: number;
  end: number;
  bases: string[];
}

interface ResourceLimits {
  maxSourceBytes: number;
  maxContracts: number;
  maxGraphNodes: number;
  maxGraphEdges: number;
  maxDfsDepth: number;
}

const ROOT_ROLE_PATTERN =
  /^(?:DEFAULT_ADMIN_ROLE|ROOT_ADMIN_ROLE|SUPER_ADMIN_ROLE|0x0+|bytes32\s*\(\s*0\s*\))$/i;
const CRITICAL_ROLE_PATTERN =
  /(?:UPGRADER|UPGRADE|PROXY_ADMIN|TIMELOCK_ADMIN|GOVERNANCE|GOVERNOR|SECURITY_COUNCIL|ADMIN|OWNER)/i;
const MANAGER_ROLE_PATTERN =
  /(?:TREASURY|VAULT|MINTER|BURNER|BRIDGE|GUARDIAN|MANAGER|CONFIG|SIGNER|CONTROLLER)/i;
const LOW_PRIVILEGE_ROLE_PATTERN =
  /(?:OPERATOR|PAUSER|UNPAUSER|KEEPER|EXECUTOR|PROPOSER|CANCELLER|MODERATOR|BOT|RELAYER|USER|VIEWER|AUDITOR)/i;

const KNOWN_ACCESS_MODIFIERS =
  /\b(?:onlyRole|onlyOwner|onlyAdmin|onlyGovernance|onlyGovernor|onlyGuardian|onlyTimelock|onlyMultisig|auth|requiresAuth)\b/;
const INITIALIZER_MODIFIERS = /\b(?:initializer|reinitializer)\b/;
const INITIALIZER_NAME_PATTERN = /^(?:initialize\w*|init|setup|__[A-Za-z0-9_]+_init)$/;
const INLINE_AUTH_PATTERN =
  /\b(?:_checkRole|_checkOwner|hasRole\s*\([^)]*msg\.sender|msg\.sender\s*==\s*(?:owner|admin|governance|governor|timelock)|require\s*\(\s*hasRole|require\s*\(\s*msg\.sender\s*==)\b/;
const MODIFIER_AUTH_BODY_PATTERN =
  /\b(?:_checkRole|_checkOwner|hasRole|msg\.sender\s*==|onlyRole|onlyOwner)\b/;

function resolveLimits(options?: RoleAdminGraphOptions): ResourceLimits {
  const positive = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : fallback;
  return {
    maxSourceBytes: positive(options?.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES),
    maxContracts: positive(options?.maxContracts, DEFAULT_MAX_CONTRACTS),
    maxGraphNodes: positive(options?.maxGraphNodes, DEFAULT_MAX_GRAPH_NODES),
    maxGraphEdges: positive(options?.maxGraphEdges, DEFAULT_MAX_GRAPH_EDGES),
    maxDfsDepth: positive(options?.maxDfsDepth, DEFAULT_MAX_DFS_DEPTH),
  };
}

function extractPragmaSolidity(source: string): string | null {
  const match = /\bpragma\s+solidity\s+([^;]+);/.exec(source);
  return match ? match[1].trim() : null;
}

function computeInputDigest(
  source: string,
  options?: RoleAdminGraphOptions,
): string {
  const canonicalOptions = {
    extraPrivilegedRoles: [...(options?.extraPrivilegedRoles ?? [])].sort(),
    allowedAdminEdges: [...(options?.allowedAdminEdges ?? [])]
      .map((e) => `${e.role}:${e.adminRole}`)
      .sort(),
  };
  return createHash("sha256")
    .update(ROLE_ADMIN_VALIDATOR_VERSION)
    .update("\0")
    .update(JSON.stringify(canonicalOptions))
    .update("\0")
    .update(source)
    .digest("hex");
}

function normalizeRoleName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (
    trimmed === "0x00" ||
    /^0x0+$/.test(trimmed) ||
    /^bytes32\s*\(\s*0\s*\)$/.test(trimmed) ||
    trimmed === "0"
  ) {
    return "DEFAULT_ADMIN_ROLE";
  }
  const member = /(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)$/.exec(trimmed);
  return member ? member[1] : trimmed;
}

function classifyRoleTier(
  role: string,
  extraPrivilegedRoles: Set<string>,
): RoleTier {
  if (ROOT_ROLE_PATTERN.test(role)) return 4;
  if (extraPrivilegedRoles.has(role) || CRITICAL_ROLE_PATTERN.test(role)) return 3;
  if (LOW_PRIVILEGE_ROLE_PATTERN.test(role)) return 1;
  if (MANAGER_ROLE_PATTERN.test(role)) return 2;
  return 2;
}

function extractContractBlocks(code: string): ContractBlock[] {
  const blocks: ContractBlock[] = [];
  const pattern =
    /\b(?:abstract\s+)?(contract|library|interface)\s+([A-Za-z_$][\w$]*)([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const end = findMatchingClose(code, open, "{", "}");
    if (end < 0) continue;
    const headerTail = match[3] ?? "";
    const isMatch = /\bis\s+([\s\S]+)$/.exec(headerTail);
    const bases: string[] = [];
    if (isMatch) {
      let depth = 0;
      let token = "";
      for (const ch of isMatch[1]) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (ch === "," && depth === 0) {
          const baseName = /^([A-Za-z_$][\w$]*)/.exec(token.trim())?.[1];
          if (baseName) bases.push(baseName);
          token = "";
          continue;
        }
        if (depth === 0) token += ch;
      }
      const lastBase = /^([A-Za-z_$][\w$]*)/.exec(token.trim())?.[1];
      if (lastBase) bases.push(lastBase);
    }
    blocks.push({
      kind: match[1] as ContractBlock["kind"],
      name: match[2],
      start: open,
      end,
      bases,
    });
  }
  return blocks;
}

function collectInheritedContracts(
  contractName: string,
  byName: Map<string, ContractBlock>,
  maxDepth: number,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const visit = (name: string, depth: number) => {
    if (visited.has(name) || depth > maxDepth) return;
    visited.add(name);
    const block = byName.get(name);
    if (!block) return;
    for (const base of block.bases) {
      visit(base, depth + 1);
    }
    order.push(name);
  };
  visit(contractName, 0);
  return order;
}

function isLegacyConstructor(
  fn: FunctionModel,
  enclosingContract: ContractBlock | undefined,
  pragmaSolidity: string | null,
): boolean {
  if (fn.kind === "constructor") return true;
  if (!enclosingContract || fn.name !== enclosingContract.name) return false;
  if (!pragmaSolidity) return true;
  return /\b0\.[4]\.\d+\b/.test(pragmaSolidity);
}

function isPublicOrExternal(fn: FunctionModel): boolean {
  const afterClose = fn.header.slice(fn.header.indexOf(")") + 1);
  if (/\b(?:internal|private)\b/.test(afterClose)) return false;
  if (/\b(?:external|public)\b/.test(afterClose)) return true;
  // In Solidity 0.4.x, functions without explicit visibility default to public.
  return true;
}

function extractSetRoleAdminCalls(
  code: string,
  bodyStart: number,
  bodyEnd: number,
): Array<{ role: string; adminRole: string; offset: number; callEnd: number }> {
  if (bodyStart < 0 || bodyEnd <= bodyStart) return [];
  const body = code.slice(bodyStart + 1, bodyEnd);
  const calls: Array<{
    role: string;
    adminRole: string;
    offset: number;
    callEnd: number;
  }> = [];
  const pattern = /\b_?setRoleAdmin\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const openInBody = match.index + match[0].length - 1;
    const open = bodyStart + 1 + openInBody;
    const close = findMatchingClose(code, open, "(", ")");
    if (close < 0 || close > bodyEnd) continue;
    const args = splitTopLevelArguments(code, open, close);
    if (args.length !== 2) continue;
    const role = normalizeRoleName(code.slice(args[0].start, args[0].end));
    const adminRole = normalizeRoleName(code.slice(args[1].start, args[1].end));
    if (!role || !adminRole) continue;
    calls.push({
      role,
      adminRole,
      offset: bodyStart + 1 + match.index,
      callEnd: close + 1,
    });
  }
  return calls;
}

function extractRoleGrantCalls(
  code: string,
  bodyStart: number,
  bodyEnd: number,
): Array<{ role: string; offset: number; callEnd: number }> {
  if (bodyStart < 0 || bodyEnd <= bodyStart) return [];
  const body = code.slice(bodyStart + 1, bodyEnd);
  const calls: Array<{ role: string; offset: number; callEnd: number }> = [];
  const pattern = /\b(?:_grantRole|_setupRole)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const openInBody = match.index + match[0].length - 1;
    const open = bodyStart + 1 + openInBody;
    const close = findMatchingClose(code, open, "(", ")");
    if (close < 0 || close > bodyEnd) continue;
    const args = splitTopLevelArguments(code, open, close);
    if (args.length < 2) continue;
    const role = normalizeRoleName(code.slice(args[0].start, args[0].end));
    if (!role) continue;
    calls.push({
      role,
      offset: bodyStart + 1 + match.index,
      callEnd: close + 1,
    });
  }
  return calls;
}

function extractHelperCalls(
  code: string,
  bodyStart: number,
  bodyEnd: number,
): Array<{ callee: string; args: string[]; offset: number; callEnd: number }> {
  if (bodyStart < 0 || bodyEnd <= bodyStart) return [];
  const body = code.slice(bodyStart + 1, bodyEnd);
  const calls: Array<{ callee: string; args: string[]; offset: number; callEnd: number }> = [];
  const pattern = /\b(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const callee = match[1];
    if (
      callee === "require" ||
      callee === "assert" ||
      callee === "revert" ||
      callee === "if" ||
      callee === "for" ||
      callee === "while" ||
      callee === "_setRoleAdmin" ||
      callee === "setRoleAdmin" ||
      callee === "_grantRole" ||
      callee === "_setupRole"
    ) {
      continue;
    }
    const open = bodyStart + 1 + match.index + match[0].length - 1;
    const close = findMatchingClose(code, open, "(", ")");
    if (close < 0 || close > bodyEnd) continue;
    const args = splitTopLevelArguments(code, open, close).map((a) =>
      code.slice(a.start, a.end).trim(),
    );
    calls.push({
      callee,
      args,
      offset: bodyStart + 1 + match.index,
      callEnd: close + 1,
    });
  }
  return calls;
}

export function validateRoleAdminGraph(
  input: unknown,
  options?: RoleAdminGraphOptions,
): RoleAdminGraphReport {
  const limits = resolveLimits(options);
  const rawSource = typeof input === "string" ? input : "";
  const inputDigest = computeInputDigest(rawSource, options);

  const emptyReport = (
    diagnostic: string,
    pragmaSolidity: string | null = null,
  ): RoleAdminGraphReport => ({
    findings: [],
    diagnostics: [diagnostic],
    graph: { nodes: [], edges: [] },
    toolchain: {
      analyzer: "RoleAdminGraphValidator",
      validatorVersion: ROLE_ADMIN_VALIDATOR_VERSION,
      pragmaSolidity,
      analysisMode: "static-source-pattern",
      executesRepoCode: false,
    },
    inputDigest,
  });

  if (typeof input !== "string") {
    return emptyReport("Role-admin graph analysis requires Solidity source text.");
  }
  if (input.includes("\0")) {
    return emptyReport(
      "Role-admin graph analysis skipped: binary NUL byte detected in source.",
    );
  }
  const sourceBytes = Buffer.byteLength(input, "utf8");
  if (sourceBytes > limits.maxSourceBytes) {
    return emptyReport(
      `Role-admin graph analysis skipped: source size ${sourceBytes} bytes exceeds limit of ${limits.maxSourceBytes} bytes.`,
    );
  }

  const prepared = prepareSoliditySource(input, "Role-admin graph");
  if (!prepared.ok) {
    return emptyReport(prepared.diagnostic);
  }

  const { code } = prepared;
  const pragmaSolidity = extractPragmaSolidity(code);
  const contracts = extractContractBlocks(code);
  if (contracts.length > limits.maxContracts) {
    return emptyReport(
      `Role-admin graph analysis skipped: contract count ${contracts.length} exceeds limit of ${limits.maxContracts}.`,
      pragmaSolidity,
    );
  }

  const extraPrivilegedRoles = new Set(
    (options?.extraPrivilegedRoles ?? []).map((r) => normalizeRoleName(r)),
  );
  const allowedAdminEdges = new Set(
    (options?.allowedAdminEdges ?? []).map(
      (e) => `${normalizeRoleName(e.role)}<-${normalizeRoleName(e.adminRole)}`,
    ),
  );

  const callables = extractCallables(code);
  const contractByName = new Map(contracts.map((c) => [c.name, c]));

  const enclosingContractOf = (offset: number): ContractBlock | undefined =>
    contracts.find((c) => offset > c.start && offset < c.end);

  const customAuthModifiers = new Set<string>();
  for (const fn of callables) {
    if (fn.kind !== "modifier" || fn.bodyStart < 0) continue;
    const modBody = code.slice(fn.bodyStart + 1, fn.bodyEnd);
    if (MODIFIER_AUTH_BODY_PATTERN.test(modBody)) {
      customAuthModifiers.add(fn.name);
    }
  }

  const hasAccessControl = (fn: FunctionModel, contractBlock: ContractBlock | undefined): boolean => {
    const afterParams = fn.header.slice(fn.header.indexOf(")") + 1);
    if (KNOWN_ACCESS_MODIFIERS.test(afterParams)) return true;
    for (const modName of customAuthModifiers) {
      if (new RegExp(String.raw`\b${modName.replace(/\$/g, "\\$")}\b`).test(afterParams)) {
        return true;
      }
    }
    if (INITIALIZER_NAME_PATTERN.test(fn.name) && INITIALIZER_MODIFIERS.test(afterParams)) {
      return true;
    }
    if (fn.bodyStart >= 0) {
      const body = code.slice(fn.bodyStart + 1, fn.bodyEnd);
      if (INLINE_AUTH_PATTERN.test(body)) return true;
    }
    if (isLegacyConstructor(fn, contractBlock, pragmaSolidity)) return true;
    return false;
  };

  // Map internal/library functions by name for bounded helper resolution.
  const internalHelpers = new Map<string, FunctionModel[]>();
  for (const fn of callables) {
    if (fn.kind !== "function" || fn.bodyStart < 0) continue;
    const afterParams = fn.header.slice(fn.header.indexOf(")") + 1);
    const enc = enclosingContractOf(fn.start);
    if (enc?.kind === "library" || /\binternal\b|\bprivate\b/.test(afterParams)) {
      const list = internalHelpers.get(fn.name) ?? [];
      list.push(fn);
      internalHelpers.set(fn.name, list);
    }
  }

  const contractDirectEdges = new Map<string, RoleAdminEdge[]>();
  const findings: RoleAdminFinding[] = [];
  const allNodes = new Set<string>();
  const allEdges: RoleAdminEdge[] = [];
  const diagnostics: string[] = [];

  const collectEdgesFromCallable = (
    fn: FunctionModel,
    contractName: string,
    visitedHelpers: Set<string>,
    depth: number,
    viaHelper?: string,
    bindings?: Map<string, string>,
  ): RoleAdminEdge[] => {
    if (depth > 3 || fn.bodyStart < 0) return [];
    const resolveRole = (name: string) => bindings?.get(name) ?? name;
    const edges: RoleAdminEdge[] = [];
    for (const call of extractSetRoleAdminCalls(code, fn.bodyStart, fn.bodyEnd)) {
      const loc = lineAndColumn(input, call.offset);
      const endLoc = lineAndColumn(input, call.callEnd);
      edges.push({
        contractName,
        functionName: fn.name,
        role: resolveRole(call.role),
        adminRole: resolveRole(call.adminRole),
        line: loc.line,
        startColumn: loc.column,
        endColumn: endLoc.column,
        ...(viaHelper ? { viaHelper } : {}),
      });
    }
    for (const helperCall of extractHelperCalls(code, fn.bodyStart, fn.bodyEnd)) {
      const targets = internalHelpers.get(helperCall.callee);
      if (!targets || visitedHelpers.has(helperCall.callee)) continue;
      visitedHelpers.add(helperCall.callee);
      for (const target of targets) {
        const nextBindings = new Map<string, string>();
        target.params.forEach((p, idx) => {
          if (p.name && helperCall.args[idx] !== undefined) {
            nextBindings.set(p.name, resolveRole(normalizeRoleName(helperCall.args[idx])));
          }
        });
        edges.push(
          ...collectEdgesFromCallable(
            target,
            contractName,
            visitedHelpers,
            depth + 1,
            helperCall.callee,
            nextBindings,
          ),
        );
      }
      visitedHelpers.delete(helperCall.callee);
    }
    return edges;
  };

  for (const fn of callables) {
    if (fn.kind === "modifier" || fn.bodyStart < 0) continue;
    const enc = enclosingContractOf(fn.start);
    if (!enc || enc.kind === "interface") continue;

    // Collect role-admin edges for concrete/abstract contracts (libraries contribute via callers).
    if (enc.kind === "contract") {
      const edges = collectEdgesFromCallable(fn, enc.name, new Set(), 0);
      if (edges.length > 0) {
        const list = contractDirectEdges.get(enc.name) ?? [];
        list.push(...edges);
        contractDirectEdges.set(enc.name, list);
      }
    }

    // Check unprotected external/public role-admin or role-grant mutations.
    if (
      enc.kind === "contract" &&
      fn.kind === "function" &&
      isPublicOrExternal(fn) &&
      !isLegacyConstructor(fn, enc, pragmaSolidity) &&
      !hasAccessControl(fn, enc)
    ) {
      const directAdminCalls = extractSetRoleAdminCalls(code, fn.bodyStart, fn.bodyEnd);
      const directGrantCalls = extractRoleGrantCalls(code, fn.bodyStart, fn.bodyEnd);
      for (const call of directAdminCalls) {
        const loc = lineAndColumn(input, call.offset);
        const endLoc = lineAndColumn(input, call.callEnd);
        const isInit = INITIALIZER_NAME_PATTERN.test(fn.name);
        findings.push({
          ruleId: ROLE_ADMIN_RULE_ID,
          issueType: "unprotected-role-admin-mutation",
          contractName: enc.name,
          functionName: fn.name,
          role: call.role,
          adminRole: call.adminRole,
          escalationPath: [call.adminRole, call.role],
          line: loc.line,
          startColumn: loc.column,
          endColumn: endLoc.column,
          confidence: 0.92,
          evidence: [
            isInit
              ? `Initializer '${fn.name}' calls _setRoleAdmin(${call.role}, ${call.adminRole}) without an initializer/reinitializer or access-control guard.`
              : `Public/external function '${fn.name}' calls _setRoleAdmin(${call.role}, ${call.adminRole}) without an access-control modifier or inline authorization check.`,
          ],
          impact:
            "Any unprivileged caller can rewire the role-admin graph and assign themselves admin control over privileged roles.",
          remediation: isInit
            ? "Add the `initializer` (or `reinitializer`) modifier and restrict re-wiring to `onlyRole(DEFAULT_ADMIN_ROLE)`."
            : "Restrict the function with `onlyRole(DEFAULT_ADMIN_ROLE)` (or equivalent governance/timelock modifier).",
          severityRationale:
            "Unprotected role-admin graph mutation allows immediate arbitrary privilege escalation.",
        });
      }
      for (const grant of directGrantCalls) {
        const tier = classifyRoleTier(grant.role, extraPrivilegedRoles);
        if (tier < 3) continue;
        const loc = lineAndColumn(input, grant.offset);
        const endLoc = lineAndColumn(input, grant.callEnd);
        const isInit = INITIALIZER_NAME_PATTERN.test(fn.name);
        findings.push({
          ruleId: ROLE_ADMIN_RULE_ID,
          issueType: "unprotected-role-admin-mutation",
          contractName: enc.name,
          functionName: fn.name,
          role: grant.role,
          adminRole: "NONE",
          escalationPath: [grant.role],
          line: loc.line,
          startColumn: loc.column,
          endColumn: endLoc.column,
          confidence: 0.9,
          evidence: [
            isInit
              ? `Initializer '${fn.name}' grants privileged role '${grant.role}' without an initializer/reinitializer or access-control guard.`
              : `Public/external function '${fn.name}' grants privileged role '${grant.role}' without an access-control modifier or inline authorization check.`,
          ],
          impact:
            "An unprivileged caller can invoke this entry point to obtain a privileged role directly.",
          remediation: isInit
            ? "Protect the initializer with `initializer` (and `_disableInitializers()` in the implementation constructor)."
            : "Restrict the function with `onlyRole(DEFAULT_ADMIN_ROLE)` or remove the public `_grantRole`/`_setupRole` path.",
          severityRationale:
            "Direct unguarded granting of root or upgrade roles enables full contract takeover.",
        });
      }
    }
  }

  // Build effective role-admin graph per concrete contract (including inherited contracts).
  for (const contract of contracts) {
    if (contract.kind !== "contract") continue;
    const lineage = collectInheritedContracts(
      contract.name,
      contractByName,
      limits.maxContracts,
    );
    const effectiveEdges: RoleAdminEdge[] = [];
    const seenEdges = new Set<string>();
    for (const ancestor of lineage) {
      const edges = contractDirectEdges.get(ancestor);
      if (edges) {
        for (const edge of edges) {
          const dedupKey = `${edge.role}<-${edge.adminRole}@${edge.line}`;
          if (seenEdges.has(dedupKey)) continue;
          seenEdges.add(dedupKey);
          effectiveEdges.push({ ...edge, contractName: contract.name });
        }
      }
    }
    if (effectiveEdges.length === 0) continue;

    if (allEdges.length + effectiveEdges.length > limits.maxGraphEdges) {
      diagnostics.push(
        `Role-admin graph edge limit (${limits.maxGraphEdges}) reached while analyzing '${contract.name}'; remaining edges truncated.`,
      );
      break;
    }
    allEdges.push(...effectiveEdges);

    // Adjacency: adminRole -> Array<{ role, edge }>
    const adj = new Map<string, Array<{ role: string; edge: RoleAdminEdge }>>();
    const contractNodes = new Set<string>();
    for (const edge of effectiveEdges) {
      contractNodes.add(edge.role);
      contractNodes.add(edge.adminRole);
      allNodes.add(edge.role);
      allNodes.add(edge.adminRole);
      const list = adj.get(edge.adminRole) ?? [];
      list.push({ role: edge.role, edge });
      adj.set(edge.adminRole, list);
    }

    if (allNodes.size > limits.maxGraphNodes) {
      diagnostics.push(
        `Role-admin graph node limit (${limits.maxGraphNodes}) reached while analyzing '${contract.name}'.`,
      );
      break;
    }

    // 1. Direct privilege escalation edges & self-loops
    for (const edge of effectiveEdges) {
      const edgeKey = `${edge.role}<-${edge.adminRole}`;
      if (allowedAdminEdges.has(edgeKey)) continue;

      if (edge.role === edge.adminRole && edge.role !== "DEFAULT_ADMIN_ROLE") {
        findings.push({
          ruleId: ROLE_ADMIN_RULE_ID,
          issueType: "role-admin-cycle",
          contractName: contract.name,
          functionName: edge.functionName,
          role: edge.role,
          adminRole: edge.adminRole,
          escalationPath: [edge.adminRole, edge.role],
          line: edge.line,
          startColumn: edge.startColumn,
          endColumn: edge.endColumn,
          confidence: 0.95,
          evidence: [
            `Role '${edge.role}' is configured as its own admin via _setRoleAdmin(${edge.role}, ${edge.adminRole})${edge.viaHelper ? ` (via ${edge.viaHelper})` : ""}.`,
          ],
          impact:
            "Any holder of this role can grant the role to arbitrary accounts and bypass root admin governance.",
          remediation: `Keep '${edge.role}' administered by DEFAULT_ADMIN_ROLE or a strictly higher-tier governance role.`,
          severityRationale:
            "Self-administering roles allow lateral/horizontal proliferation and evade centralized revocation.",
        });
        continue;
      }

      const targetTier = classifyRoleTier(edge.role, extraPrivilegedRoles);
      const adminTier = classifyRoleTier(edge.adminRole, extraPrivilegedRoles);
      if (adminTier < targetTier) {
        findings.push({
          ruleId: ROLE_ADMIN_RULE_ID,
          issueType: "privilege-escalation-edge",
          contractName: contract.name,
          functionName: edge.functionName,
          role: edge.role,
          adminRole: edge.adminRole,
          escalationPath: [edge.adminRole, edge.role],
          line: edge.line,
          startColumn: edge.startColumn,
          endColumn: edge.endColumn,
          confidence: 0.93,
          evidence: [
            `Lower-tier role '${edge.adminRole}' (tier ${adminTier}) is set as admin of higher-privilege role '${edge.role}' (tier ${targetTier})${edge.viaHelper ? ` via helper '${edge.viaHelper}'` : ""}.`,
          ],
          impact: `Any holder of '${edge.adminRole}' can call grantRole(${edge.role}, attacker) to escalate to '${edge.role}'.`,
          remediation: `Assign DEFAULT_ADMIN_ROLE or a higher-privilege governance role as the admin of '${edge.role}'.`,
          severityRationale:
            "Granting a lower-tier role administrative control over a critical/root role enables direct privilege escalation.",
        });
      }
    }

    // 2. Bounded DFS for multi-hop cycles and transitive privilege escalation
    const reportedTransitive = new Set<string>();
    const reportedCycles = new Set<string>();

    for (const startNode of Array.from(contractNodes).sort()) {
      const startTier = classifyRoleTier(startNode, extraPrivilegedRoles);
      const stack: Array<{
        node: string;
        path: string[];
        firstEdge: RoleAdminEdge | null;
      }> = [{ node: startNode, path: [startNode], firstEdge: null }];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.path.length > limits.maxDfsDepth) continue;

        const neighbors = adj.get(current.node) ?? [];
        for (const { role: nextNode, edge } of neighbors) {
          const edgeKey = `${edge.role}<-${edge.adminRole}`;
          if (allowedAdminEdges.has(edgeKey)) continue;

          const firstEdge = current.firstEdge ?? edge;

          // Multi-hop cycle back to startNode (length >= 2 edges)
          if (nextNode === startNode && current.path.length >= 2) {
            const cycleNodes = [...current.path, startNode];
            const canonical = [...current.path].sort().join(",");
            if (!reportedCycles.has(canonical)) {
              reportedCycles.add(canonical);
              findings.push({
                ruleId: ROLE_ADMIN_RULE_ID,
                issueType: "role-admin-cycle",
                contractName: contract.name,
                functionName: firstEdge.functionName,
                role: firstEdge.role,
                adminRole: firstEdge.adminRole,
                escalationPath: cycleNodes,
                line: firstEdge.line,
                startColumn: firstEdge.startColumn,
                endColumn: firstEdge.endColumn,
                confidence: 0.94,
                evidence: [
                  `Role-admin cycle detected in '${contract.name}': ${cycleNodes.join(" -> ")}.`,
                ],
                impact:
                  "Any holder of a role in the cycle can transitively grant themselves every other role in the cycle.",
                remediation:
                  "Break the cycle so the role-admin graph forms a strict DAG rooted at DEFAULT_ADMIN_ROLE.",
                severityRationale:
                  "Cyclic role-admin relationships allow mutual privilege escalation across all roles in the cycle.",
              });
            }
            continue;
          }

          if (current.path.includes(nextNode)) continue;

          const nextPath = [...current.path, nextNode];
          const nextTier = classifyRoleTier(nextNode, extraPrivilegedRoles);

          // Transitive escalation (2+ hops) where startNode < nextNode
          if (nextPath.length >= 3 && startTier < nextTier) {
            const key = `${contract.name}:${startNode}->${nextNode}`;
            if (!reportedTransitive.has(key)) {
              reportedTransitive.add(key);
              findings.push({
                ruleId: ROLE_ADMIN_RULE_ID,
                issueType: "transitive-admin-escalation",
                contractName: contract.name,
                functionName: firstEdge.functionName,
                role: nextNode,
                adminRole: startNode,
                escalationPath: nextPath,
                line: firstEdge.line,
                startColumn: firstEdge.startColumn,
                endColumn: firstEdge.endColumn,
                confidence: 0.88,
                evidence: [
                  `Transitive escalation path in '${contract.name}': ${nextPath.join(" -> ")} (tier ${startTier} to tier ${nextTier}).`,
                ],
                impact: `Holders of '${startNode}' can escalate through intermediate role admins to gain '${nextNode}'.`,
                remediation:
                  "Ensure every transitive role-admin path flows strictly downward from higher-privilege roles to lower-privilege roles.",
                severityRationale:
                  "Multi-hop role-admin chains can obscure unintended privilege escalation paths to critical roles.",
              });
            }
          }

          stack.push({ node: nextNode, path: nextPath, firstEdge });
        }
      }
    }
  }

  // Deterministic ordering
  findings.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.startColumn !== b.startColumn) return a.startColumn - b.startColumn;
    if (a.endColumn !== b.endColumn) return a.endColumn - b.endColumn;
    if (a.issueType !== b.issueType) return a.issueType.localeCompare(b.issueType);
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return a.adminRole.localeCompare(b.adminRole);
  });

  return {
    findings,
    diagnostics,
    graph: {
      nodes: Array.from(allNodes).sort(),
      edges: allEdges.sort((a, b) => a.line - b.line || a.role.localeCompare(b.role)),
    },
    toolchain: {
      analyzer: "RoleAdminGraphValidator",
      validatorVersion: ROLE_ADMIN_VALIDATOR_VERSION,
      pragmaSolidity,
      analysisMode: "static-source-pattern",
      executesRepoCode: false,
    },
    inputDigest,
  };
}
