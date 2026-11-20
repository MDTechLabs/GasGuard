/**
 * GG-XCHAIN-PAYLOAD-001 — Detect message payload decoding without version or
 * schema validation.
 *
 * `abi.decode` silently accepts trailing bytes and has no notion of message
 * type. A cross-domain handler that decodes a payload and acts on the result
 * without validating a version/type discriminator (or an exact length) will
 * mis-handle future formats, truncated or re-purposed payloads. The rule traces
 * decoded fields into state-changing operations and reports:
 *
 *   - `no-version-field`            no discriminator among the decoded fields and
 *                                   no exact length check pins the schema
 *   - `unvalidated-version`         a version/type field is decoded but never
 *                                   compared before the data is used
 *   - `unsupported-version-fallthrough`  an if-chain dispatches on the version
 *                                   with no terminal revert for unknown versions
 *   - `ambiguous-payload-format`    the same payload is decoded with different
 *                                   shapes and nothing selects between them
 *
 * Explicit backward-compatible handling is recognized and accepted: equality
 * guards (`require(version == X)`, `if (version != X) revert`), if-chains that
 * end in `else revert`, struct members checked through the decoded variable,
 * and exact payload-length checks.
 *
 * Supported: Solidity 0.6 – 0.8.x. Intra-function only; decoders in other
 * functions or contracts are not followed. See
 * docs/rules/signature-and-cross-domain-message-security.md.
 */

import {
  Diagnostic,
  RuleResult,
  SecurityFinding,
  SolFunction,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findEffects,
  findMatching,
  isMessageReceiver,
  makeFinding,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-XCHAIN-PAYLOAD-001';

export interface PayloadDecodingOptions {
  receiverNames?: string[];
  /** Extra regular-expression sources naming version/type discriminator fields. */
  discriminatorNames?: string[];
}

const DISC_RE =
  /^(\w*[vV]ersion|\w*[Mm]sgType|\w*[Mm]essageType|\w*[Pp]ayloadType|\w*[Mm]sgKind|action|opcode|kind|schema\w*|selector|op|typeId|\w*Type)$/;

interface DecodeSite {
  offset: number;
  payloadExpr: string;
  signature: string;
  fields: string[];
  discriminators: string[];
  decodedNames: string[];
}

function esc(expr: string): string {
  return expr.replace(/[.$]/g, '\\$&');
}

function structMembers(masked: string, typeName: string): string[] | undefined {
  const m = new RegExp(`\\bstruct\\s+${esc(typeName)}\\s*\\{`).exec(masked);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  const close = findMatching(masked, open);
  if (close === -1) return undefined;
  return masked
    .slice(open + 1, close)
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => /([A-Za-z_$][\w$]*)$/.exec(d)?.[1] ?? '')
    .filter(Boolean);
}

function decodeSites(fn: SolFunction, masked: string, source: string, extraDisc: RegExp[]): DecodeSite[] {
  const sites: DecodeSite[] = [];
  const isDisc = (n: string) => DISC_RE.test(n) || extraDisc.some((r) => r.test(n));
  const statements = statementsOf(fn, source);
  const re = /\babi\s*\.\s*decode\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fn.body)) !== null) {
    const open = fn.bodyOffset + m.index + m[0].length - 1;
    const close = findMatching(masked, open, '(', ')');
    if (close === -1) continue;
    const args = splitTopLevel(masked.slice(open + 1, close));
    if (args.length < 2) continue;
    const signature = args[1].replace(/\s+/g, '');
    const st = statements.find((s) => open >= s.offset && open <= s.offset + s.text.length);
    const fields: string[] = [];
    const discriminators: string[] = [];
    const decodedNames: string[] = [];
    if (st) {
      const eq = st.text.search(/[^=!<>]=(?!=)/);
      const lhs = eq === -1 ? '' : st.text.slice(0, eq + 1).trim();
      if (lhs.startsWith('(')) {
        for (const part of splitTopLevel(lhs.slice(1, lhs.lastIndexOf(')')))) {
          const name = /([A-Za-z_$][\w$]*)\s*$/.exec(part.trim())?.[1];
          if (name && /\s/.test(part.trim())) {
            fields.push(name);
            decodedNames.push(name);
            if (isDisc(name)) discriminators.push(name);
          }
        }
      } else if (lhs) {
        const toks = lhs.replace(/\b(memory|calldata|storage)\b/g, '').trim().split(/\s+/);
        const name = toks[toks.length - 1];
        const typeName = toks[0];
        if (name && toks.length >= 2) {
          fields.push(name);
          decodedNames.push(name);
          for (const member of structMembers(masked, typeName) ?? []) {
            if (isDisc(member)) discriminators.push(`${name}.${member}`);
          }
        }
      }
    }
    sites.push({ offset: open, payloadExpr: args[0].trim(), signature, fields, discriminators, decodedNames });
  }
  // Locally derived discriminators, e.g. `uint8 version = uint8(payload[0]);`.
  const local = /\b(?:u?int\d*|bytes\d*)\s+([A-Za-z_$][\w$]*)\s*=/g;
  const localNames: string[] = [];
  while ((m = local.exec(fn.body)) !== null) if (isDisc(m[1])) localNames.push(m[1]);
  for (const s of sites) for (const l of localNames) if (!s.discriminators.includes(l)) s.discriminators.push(l);
  return sites;
}

type Verdict = 'guarded' | 'fallthrough' | 'unvalidated';

function verdictFor(disc: string, body: string): Verdict {
  const d = esc(disc);
  const guarded =
    new RegExp(`\\b(require|assert)\\s*\\([^;]*\\b${d}\\b[^;]*?(==|!=|<=|>=|<|>)`).test(body) ||
    new RegExp(`\\bif\\s*\\([^)]*\\b${d}\\b[^)]*(!=|<|>)[^)]*\\)\\s*\\{?\\s*(revert|return)`).test(body);
  if (guarded) return 'guarded';
  const chain = new RegExp(`\\bif\\s*\\(\\s*${d}\\s*==`).test(body);
  if (!chain) return 'unvalidated';
  return /\belse\s*\{?\s*(revert\b|require\s*\(\s*false)/.test(body) ? 'guarded' : 'fallthrough';
}

export function detectUnvalidatedPayloadDecoding(input: unknown, options: PayloadDecodingOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const stateNames = new Set(extractStateVars(masked, source, contracts).map((v) => v.name));
  const extraDisc = (options.discriminatorNames ?? []).map((s) => new RegExp(`^(?:${s})$`));
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (!isMessageReceiver(fn, options.receiverNames)) continue;
    const sites = decodeSites(fn, masked, source, extraDisc);
    if (sites.length === 0) continue;
    const effects = findEffects(fn, stateNames, source);
    const decoded = new Set(sites.flatMap((s) => s.decodedNames));
    const tainted = effects.filter((e) => [...decoded].some((n) => new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(e.statement.text)));
    if (tainted.length === 0) continue;
    const valueMoves = tainted.some(
      (e) => e.kind === 'value-transfer' || /balance|credit|shares|supply|claimable|owed|reward/i.test(e.statement.text),
    );
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
    const flow = tainted.map((e) => ({ line: e.statement.line, statement: e.statement.text.slice(0, 80) }));
    const fields = [...decoded];
    const disc = [...new Set(sites.flatMap((s) => s.discriminators))];
    const strictLength = /\.length\s*==/.test(fn.body);
    const anyLength = /\.length\b/.test(fn.body);
    const severity = valueMoves ? 'high' : 'medium';

    if (disc.length > 0) {
      const verdicts = disc.map((d) => ({ d, v: verdictFor(d, fn.body) }));
      const bad = verdicts.find((x) => x.v !== 'guarded');
      if (!bad) continue;
      const fall = bad.v === 'fallthrough';
      findings.push(
        makeFinding(source, sites[0].offset, {
          ...base,
          kind: fall ? 'unsupported-version-fallthrough' : 'unvalidated-version',
          severity,
          confidence: 'high',
          message: fall
            ? `${fn.name}() dispatches on ${bad.d} but has no terminal revert; messages with an unknown or future version are silently accepted without effect (or hit a default path).`
            : `${fn.name}() decodes ${bad.d} but never compares it before using the decoded fields.`,
          severityRationale: valueMoves
            ? 'Decoded fields reach balance or value-moving operations under a format the handler never confirmed.'
            : 'Decoded fields reach state changes under a format the handler never confirmed.',
          confidenceEvidence: [
            `discriminator ${bad.d} decoded from ${sites[0].payloadExpr}`,
            fall ? 'if-chain on the discriminator has no `else revert`' : 'no require/assert/if-revert comparison of the discriminator',
            `fields reaching effects: ${flow.map((f) => `line ${f.line}`).join(', ')}`,
          ],
          remediation: fall
            ? 'End the version dispatch with `else revert UnsupportedVersion(version)`, or validate `require(version == SUPPORTED)` before dispatching.'
            : `Validate the discriminator first (e.g. require(${bad.d} == SUPPORTED_VERSION)) and reject unknown versions.`,
          details: { discriminator: bad.d, decodedFields: fields, flow },
        }),
      );
      continue;
    }

    const signatures = new Set(sites.map((s) => s.signature));
    if (signatures.size > 1 && !anyLength) {
      findings.push(
        makeFinding(source, sites[1].offset, {
          ...base,
          kind: 'ambiguous-payload-format',
          severity,
          confidence: 'medium',
          message: `${fn.name}() decodes the same payload with ${signatures.size} different shapes and nothing selects between them.`,
          severityRationale: 'Two layouts over one payload make the accepted format ambiguous; an attacker can steer which layout drives the effect.',
          confidenceEvidence: [`shapes: ${[...signatures].join(' | ')}`, 'no version/type field and no length check'],
          remediation: 'Add an explicit version/type discriminator and decode each version in its own validated branch.',
          details: { signatures: [...signatures], decodedFields: fields, flow },
        }),
      );
      continue;
    }
    if (strictLength) continue;
    findings.push(
      makeFinding(source, sites[0].offset, {
        ...base,
        kind: 'no-version-field',
        severity,
        confidence: 'medium',
        message: `${fn.name}() decodes ${sites[0].payloadExpr} without a version/type field or an exact length check; format changes and future versions cannot be told apart from the current one, and trailing bytes are accepted.`,
        severityRationale: valueMoves
          ? 'Decoded values drive balance or value-moving operations, so a mis-parsed payload moves funds.'
          : 'Decoded values drive state changes under an unversioned format.',
        confidenceEvidence: [
          `decoded fields: ${fields.join(', ')}`,
          'no discriminator-like field (version, msgType, kind, action, ...)',
          'no `payload.length ==` check',
        ],
        remediation:
          'Prefix payloads with a version/type byte, validate it (and the exact length where fixed) before decoding, and handle each supported version explicitly.',
        details: { decodedFields: fields, flow },
      }),
    );
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
