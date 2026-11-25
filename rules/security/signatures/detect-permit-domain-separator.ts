/**
 * GG-SIG-PERMIT-001 — Incorrectly constructed EIP-712 domain separators in permit-style contracts (#1317).
 *
 * Finds every `keccak256(abi.encode(DOMAIN_TYPEHASH, ...))` whose type hash resolves (inline string,
 * a constant in the source, or the standard 4-field hash) to an `EIP712Domain(...)` type, and checks
 * how the separator is built:
 *  - `domain-type-missing-field`: the type string omits `chainId` (high: signatures replay on every
 *    chain and fork) or `verifyingContract` (medium: signatures replay across contracts);
 *  - `domain-encoding-mismatch`: the number of encoded values differs from the number of type fields,
 *    or a field gets a value that cannot be right (`verifyingContract` = `msg.sender` / `address(0)`);
 *  - `hardcoded-chain-id`: the `chainId` value is a numeric literal, so the separator is wrong after
 *    a chain split and on every other deployment chain;
 *  - `unhashed-dynamic-field`: a `string` / `bytes` field is encoded without `keccak256`, which breaks
 *    EIP-712 compatibility with wallets (signatures never verify);
 *  - `cached-domain-separator-chainid`: a separator computed once with `block.chainid` and stored
 *    (immutable / state / constructor) is used without ever comparing `block.chainid` to the cached
 *    chain id, so it is stale after a chain fork (the Solmate/OpenZeppelin pattern recomputes on mismatch).
 * Contracts that inherit OpenZeppelin `EIP712` and build no separator themselves have nothing to report.
 *
 * Supported: Solidity 0.6 - 0.8.x, single source string; helper functions that build the encoded
 * arguments are not followed. Malformed input returns `analyzed: false`. No project scripts or
 * configuration are executed. See docs/rules/sig-permit-domain-separator.md.
 */
import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  findMatching,
  lineColumn,
  makeFinding,
  prepareSource,
  splitTopLevel,
} from '../lib/solidity-lite';
import { buildSourceModel } from '../lib/solidity-inheritance';

export const RULE_ID = 'GG-SIG-PERMIT-001';

export interface DomainEntry {
  contract: string;
  line: number;
  fields: string[];
  status: 'ok' | 'flagged';
}

export interface PermitDomainResult extends RuleResult {
  domains: DomainEntry[];
}

const ENCODE_RE = /keccak256\s*\(\s*abi\s*\.\s*encode\s*\(/g;
const STANDARD_DOMAIN_HASH: Record<string, string> = {
  '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f': 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
};
const CHAIN_COMPARE = /[!=]=\s*block\s*\.\s*chainid|block\s*\.\s*chainid\s*[!=]=/;

function resolveTypeString(arg0: string, source: string): string | null {
  const inline = /keccak256\s*\(\s*(?:bytes\s*\(\s*)?"([^"]*)"/.exec(arg0);
  if (inline) return /^EIP712Domain\(/.test(inline[1]) ? inline[1] : null;
  const hex = /^0x[0-9a-fA-F]{64}$/.exec(arg0)?.[0]?.toLowerCase();
  if (hex) return STANDARD_DOMAIN_HASH[hex] ?? null;
  if (!/^[A-Za-z_$][\w$]*$/.test(arg0)) return null;
  const decl = new RegExp(`\\b${arg0.replace(/\$/g, '\\$')}\\b\\s*=\\s*(?:keccak256\\s*\\(\\s*(?:bytes\\s*\\(\\s*)?"([^"]*)"|(0x[0-9a-fA-F]{64}))`).exec(source);
  if (!decl) return null;
  if (decl[1] !== undefined) return /^EIP712Domain\(/.test(decl[1]) ? decl[1] : null;
  return STANDARD_DOMAIN_HASH[decl[2].toLowerCase()] ?? null;
}

export function detectPermitDomainSeparator(input: unknown): PermitDomainResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics, domains: [] };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const src = buildSourceModel(masked, source, diagnostics);
  const findings: SecurityFinding[] = [];
  const domains: DomainEntry[] = [];

  for (const model of src.contracts.values()) {
    const c = model.contract;
    if (c.kind === 'interface') continue;
    const body = masked.slice(c.open, c.close);
    const add = (offset: number, f: Omit<SecurityFinding, 'ruleId' | 'line' | 'column' | 'contract' | 'function'>) =>
      findings.push(makeFinding(source, offset, { ruleId: RULE_ID, contract: c.name, ...f }));

    ENCODE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENCODE_RE.exec(body)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = findMatching(body, open, '(', ')');
      if (close === -1) continue;
      const raw = splitTopLevel(body.slice(open + 1, close));
      if (raw.length < 2) continue;
      const args = raw.map((a) => a.trim());
      const arg0 = source.slice(c.open + open + 1, c.open + open + 1 + raw[0].length).trim();
      const typeString = resolveTypeString(arg0, source);
      if (typeString === null) continue;
      const fields = (/EIP712Domain\(([^)]*)\)/.exec(typeString)?.[1] ?? '')
        .split(',')
        .map((f) => f.trim().split(/\s+/))
        .filter((p) => p.length >= 2 && p[0])
        .map((p) => ({ type: p[0], name: p[1] }));
      const at = c.open + m.index;
      const before = findings.length;
      const lower = fields.map((f) => f.name.toLowerCase());
      const missing = (['chainId', 'verifyingContract'] as const).filter((n) => !lower.includes(n.toLowerCase()));
      const evidence = [`type: ${typeString}`, `encoded values: ${args.length - 1}`];

      if (missing.length > 0) {
        const noChain = missing.includes('chainId');
        add(at, {
          kind: 'domain-type-missing-field', severity: noChain ? 'high' : 'medium', confidence: 'high',
          message: `The EIP712Domain type omits ${missing.join(' and ')}, so signatures are not bound to ${missing.map((x) => (x === 'chainId' ? 'a chain' : 'this contract')).join(' or ')}.`,
          severityRationale: noChain
            ? 'A permit signature is valid on every chain and fork where the token exists; severity high.'
            : 'A permit signature is valid for every contract that shares the name and version; severity medium.',
          confidenceEvidence: evidence,
          remediation: 'Use EIP712Domain(string name,string version,uint256 chainId,address verifyingContract) and encode block.chainid and address(this).',
          details: { missing, typeString },
        });
      } else if (args.length - 1 !== fields.length) {
        add(at, {
          kind: 'domain-encoding-mismatch', severity: 'medium', confidence: 'high',
          message: `The domain type declares ${fields.length} fields but ${args.length - 1} values are encoded.`,
          severityRationale: 'The separator is not the EIP-712 hash wallets compute, so permits either never verify or verify against the wrong domain; severity medium.',
          confidenceEvidence: [...evidence, `declared fields: ${fields.map((f) => f.name).join(', ')}`],
          remediation: 'Encode exactly one value per declared field, in declaration order.',
          details: { declared: fields.length, encoded: args.length - 1 },
        });
      }

      fields.forEach((f, i) => {
        const value = args[i + 1];
        if (value === undefined) return;
        const name = f.name.toLowerCase();
        if (name === 'chainid' && /^(?:\d+|0x[0-9a-fA-F]+)$/.test(value)) {
          add(at, {
            kind: 'hardcoded-chain-id', severity: 'medium', confidence: 'high',
            message: `chainId is the literal ${value}; the separator is wrong after a chain split and on any other deployment chain.`,
            severityRationale: 'A hardcoded chain id makes signatures replayable on a fork that keeps the id, and breaks permits on other chains; severity medium.',
            confidenceEvidence: [...evidence, `chainId value: ${value}`],
            remediation: 'Use block.chainid and recompute the separator when block.chainid changes.',
            details: { value },
          });
        } else if (name === 'verifyingcontract' && /msg\s*\.\s*sender|tx\s*\.\s*origin|address\s*\(\s*0\s*\)/.test(value)) {
          add(at, {
            kind: 'domain-encoding-mismatch', severity: 'medium', confidence: 'high',
            message: `verifyingContract is encoded as ${value} instead of address(this).`,
            severityRationale: 'The domain is bound to the caller or to nothing, not to this contract; severity medium.',
            confidenceEvidence: [...evidence, `verifyingContract value: ${value}`],
            remediation: 'Encode address(this) for verifyingContract.',
            details: { value },
          });
        } else if ((f.type === 'string' || f.type === 'bytes') && !/keccak256\s*\(|hash/i.test(value)) {
          add(at, {
            kind: 'unhashed-dynamic-field', severity: 'medium', confidence: 'medium',
            message: `${f.name} is a dynamic ${f.type} but is encoded as ${value} without keccak256; EIP-712 requires its hash.`,
            severityRationale: 'The separator differs from the one wallets compute, so signatures never verify; severity medium.',
            confidenceEvidence: [...evidence, `${f.name} value: ${value}`],
            remediation: `Encode keccak256(bytes(${value})) for ${f.name}.`,
            details: { field: f.name, value },
          });
        }
      });
      const flagged = findings.length > before;
      domains.push({ contract: c.name, line: lineColumn(source, at).line, fields: fields.map((f) => f.name), status: flagged ? 'flagged' : 'ok' });
    }

    // Separators cached at construction with block.chainid and never compared against it.
    if (c.kind !== 'contract') continue;
    const text = model.linearization.map((l) => masked.slice(l.open, l.close)).join('\n');
    if (CHAIN_COMPARE.test(text)) continue;
    for (const v of model.stateVars) {
      if (v.contract !== c.name || !/domain_?separator/i.test(v.name)) continue;
      const exprs = [v.initializer];
      const assign = new RegExp(`(?<![\\w$.])${v.name.replace(/\$/g, '\\$')}\\s*=(?!=)\\s*([^;]+);`, 'g');
      let a: RegExpExecArray | null;
      while ((a = assign.exec(body)) !== null) exprs.push(a[1]);
      const usesChain = exprs.some((e) => {
        if (/chainid/i.test(e)) return true;
        const call = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/.exec(e);
        return call ? model.functions.some((f) => f.name === call[1] && /chainid/i.test(f.body)) : false;
      });
      if (!usesChain) continue;
      add(v.offset, {
        kind: 'cached-domain-separator-chainid', severity: 'medium', confidence: 'high',
        message: `${v.name} is computed once with block.chainid and never recomputed; after a chain fork the cached separator keeps the old chain id.`,
        severityRationale: 'Permits signed for one side of a fork stay valid on the other; severity medium because it needs a contentious fork.',
        confidenceEvidence: [`${v.name} is assigned from a chain-id-dependent hash`, 'no comparison with block.chainid anywhere in the contract'],
        remediation: 'Store the initial chain id and return a recomputed separator when block.chainid differs (as Solmate and OpenZeppelin do).',
        details: { variable: v.name },
      });
    }
  }
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics, domains };
}
