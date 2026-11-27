/**
 * authority-model — who is allowed to call what, for the authorization detectors.
 *
 * Works on the multi-file `ProjectModel`. For a function it derives a "gate": the identifiers or
 * roles the caller must match (`msg.sender == owner`, `admins[msg.sender]`, `onlyRole(R)`,
 * `hasRole(R, msg.sender)`, project modifiers that perform those checks, `_checkOwner()`).
 * It also recognizes frameworks inherited by name (Ownable, AccessControl, ...) and reads the
 * comments around a contract or function to tell deliberate immutability from an accident.
 *
 * Everything is lexical and name based. Nothing is executed and no project configuration is read.
 */
import { SolFunction, splitTopLevel, statementsOf } from './solidity-lite';
import { ModelContract, ModelFunction, ProjectModel, findModifier, mro } from './project-model';

export const OWNABLE_BASE_RE = /^Ownable(2Step)?(Upgradeable)?$/;
export const ACCESS_CONTROL_BASE_RE = /^AccessControl\w*$/;
export const DEFAULT_ADMIN_RULES_RE = /^AccessControlDefaultAdminRules(Upgradeable)?$/;

/** Base names in the linearization that are not declared in the supplied sources. */
export function externalBases(model: ProjectModel, contract: string): string[] {
  const out: string[] = [];
  for (const n of mro(model, contract)) {
    for (const b of model.contracts.get(n)?.bases ?? []) if (!model.contracts.has(b)) out.push(b);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------------------------------
// Documented intent
// ---------------------------------------------------------------------------------------

export const INTENT_RE =
  /(\bimmutable\b|permissionless|ownerless|\bno[- ](owner|admin)\b|renounce[ds]?\s+(by\s+design|is\s+intended|intentional\w*)|intentional(ly)?\b|trustless|without\s+(an?\s+)?(owner|admin)|fully\s+decentrali[sz]ed|by\s+design)/i;

function stripComment(text: string): string {
  return text.replace(/^\s*\/\*+|\*+\/\s*$/g, '').replace(/^\s*(\/\/+|\*+)\s?/gm, '').trim();
}

/** The comment block (/** ... *\/ or consecutive // lines) directly above `offset`. */
export function leadingComment(source: string, offset: number): string {
  let i = offset - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  if (i < 1) return '';
  if (source[i] === '/' && source[i - 1] === '*') {
    const start = source.lastIndexOf('/*', i - 1);
    return start === -1 ? '' : stripComment(source.slice(start, i + 1));
  }
  const lines: string[] = [];
  let lineEnd = source.lastIndexOf('\n', i) + 1;
  while (lineEnd >= 0) {
    const line = source.slice(lineEnd, i + 1).trim();
    if (!line.startsWith('//')) break;
    lines.unshift(stripComment(line));
    i = lineEnd - 2;
    while (i >= 0 && source[i] === '\r') i--;
    if (i < 0) break;
    lineEnd = source.lastIndexOf('\n', i) + 1;
  }
  return lines.join('\n');
}

/** All comment text between two offsets of the original source. */
export function commentsBetween(source: string, from: number, to: number): string {
  const out: string[] = [];
  for (const m of source.slice(from, to).matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) out.push(stripComment(m[0]));
  return out.join('\n');
}

/**
 * Comment that marks the contract (or function) as deliberately immutable, ownerless or
 * permissionless. Returns the matching comment text, or undefined.
 */
export function documentedIntent(model: ProjectModel, contract: ModelContract, fn?: ModelFunction): string | undefined {
  const file = model.files.get(contract.file);
  if (!file) return undefined;
  const candidates: string[] = [];
  const decl = new RegExp(`\\b(?:abstract\\s+)?contract\\s+${contract.name.replace(/[$]/g, '\\$')}\\b`).exec(file.masked);
  if (decl) candidates.push(leadingComment(file.source, decl.index));
  if (fn) {
    const fnFile = model.files.get(fn.file);
    if (fnFile) {
      candidates.push(leadingComment(fnFile.source, fn.offset));
      candidates.push(commentsBetween(fnFile.source, fn.offset, fn.bodyOffset + fn.body.length));
    }
  }
  return candidates.find((c) => INTENT_RE.test(c));
}

// ---------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------

export interface Gate {
  /** Normalized identifiers the caller is compared with (`owner`, `admins`, `guardian`, ...). */
  tokens: string[];
  /** Role identifiers required by `onlyRole(R)` / `hasRole(R, msg.sender)` / `_checkRole(R)`. */
  roles: string[];
  evidence: string[];
}

const SENDER = '(?:msg\\.sender|_msgSender\\s*\\(\\s*\\))';
const GUARD_START_RE = /^(require|assert|if|revert)\b/;

/** Identifiers that plausibly name an administrative authority; other comparands (tokens, routers) are not gates. */
export const AUTH_NAME_RE =
  /(owner|admin|governance|governor|authority|controller|operator|manager|guardian|pauser|minter|keeper|multisig|council|timelock|\bdao\b|treasury|deployer|security|emergency|recovery|officer|steward|signer|executor|proposer|whitelist|allowlist|authorized)/i;

export function normalizeToken(name: string): string {
  return name.replace(/^_+/, '').toLowerCase();
}

/** Names compared with the caller in `text`: `msg.sender == X`, `X == msg.sender`, `M[msg.sender]`, `M[k][msg.sender]`. */
export function senderComparisons(text: string, exclude: Set<string> = new Set()): string[] {
  const names: string[] = [];
  const add = (n: string | undefined) => {
    if (n && !exclude.has(n) && !/^(msg|tx|block|address|this)$/.test(n) && AUTH_NAME_RE.test(n)) names.push(n);
  };
  for (const m of text.matchAll(new RegExp(`${SENDER}\\s*[!=]=\\s*(?:address\\s*\\(\\s*)?([A-Za-z_$][\\w$]*)`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*(?:\\(\\s*\\))?\\s*\\)?\\s*[!=]=\\s*${SENDER}`, 'g'))) add(m[1]);
  for (const m of text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*(?:\\[[^\\]]*\\]\\s*)*\\[\\s*${SENDER}\\s*\\]`, 'g'))) add(m[1]);
  return names;
}

function roleArg(text: string, call: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${call}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`, 'g'))) out.push(m[1]);
  return out;
}

function gateOfText(text: string, params: Set<string>, into: Gate, where: string): void {
  for (const n of senderComparisons(text, params)) {
    into.tokens.push(normalizeToken(n));
    into.evidence.push(`${where}: caller compared with ${n}`);
  }
  for (const r of [...roleArg(text, 'hasRole'), ...roleArg(text, '_checkRole'), ...roleArg(text, 'onlyRole')]) {
    into.roles.push(r);
    into.evidence.push(`${where}: requires role ${r}`);
  }
  if (/\b_checkOwner\s*\(/.test(text) || /\b_onlyOwner\s*\(/.test(text)) {
    into.tokens.push('owner');
    into.evidence.push(`${where}: _checkOwner()`);
  }
  for (const m of text.matchAll(new RegExp(`\\b(?:is|has)([A-Z]\\w*)\\s*\\(\\s*${SENDER}\\s*\\)`, 'g'))) {
    into.tokens.push(normalizeToken(m[1]));
    into.evidence.push(`${where}: ${m[0].slice(0, 40)}`);
  }
}

/**
 * Who may call `fn`: modifiers (project-defined ones are read, others are interpreted by name),
 * and guard statements in the body (`require` / `assert` / `if ... revert`).
 */
export function gateOf(model: ProjectModel, contract: string, fn: SolFunction & { file?: string }): Gate {
  const gate: Gate = { tokens: [], roles: [], evidence: [] };
  const params = new Set(fn.params.map((p) => p.name).filter(Boolean));
  for (const name of fn.modifiers) {
    const mod = findModifier(model, contract, name);
    if (mod?.hasBody) {
      const sub: Gate = { tokens: [], roles: [], evidence: [] };
      const modParams = new Set(mod.params.map((p) => p.name).filter(Boolean));
      gateOfText(mod.body, modParams, sub, `modifier ${name}`);
      gate.tokens.push(...sub.tokens);
      gate.roles.push(...sub.roles);
      gate.evidence.push(...sub.evidence);
      if (sub.tokens.length + sub.roles.length > 0) continue;
    }
    const role = /^onlyRole$/.test(name) ? /onlyRole\s*\(\s*([A-Za-z_$][\w$]*)/.exec(fn.header)?.[1] : undefined;
    if (role) {
      gate.roles.push(role);
      gate.evidence.push(`modifier onlyRole(${role})`);
    } else if (/^only[A-Z]\w*$/.test(name)) {
      gate.tokens.push(normalizeToken(name.slice(4)));
      gate.evidence.push(`modifier ${name}`);
    } else if (/^(auth|requiresAuth|restricted)$/.test(name)) {
      gate.tokens.push(name.toLowerCase());
      gate.evidence.push(`modifier ${name}`);
    }
  }
  const file = (fn as ModelFunction).file ? model.files.get((fn as ModelFunction).file) : undefined;
  for (const st of statementsOf(fn, file?.source ?? '')) {
    if (GUARD_START_RE.test(st.text) || /^(_checkOwner|_checkRole|_onlyOwner)\b/.test(st.text)) gateOfText(st.text, params, gate, fn.name);
  }
  gate.tokens = [...new Set(gate.tokens)];
  gate.roles = [...new Set(gate.roles)];
  return gate;
}

export function isGated(gate: Gate): boolean {
  return gate.tokens.length + gate.roles.length > 0;
}

/** Argument texts of the first call of `name(...)` in `text`. */
export function callArgs(text: string, name: string): string[] | undefined {
  const m = new RegExp(`(?<![\\w$.])${name}\\s*\\(`).exec(text);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return splitTopLevel(text.slice(open + 1, i)).map((a) => a.trim());
    }
  }
  return undefined;
}
