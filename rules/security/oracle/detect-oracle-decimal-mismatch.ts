/**
 * GG-ORACLE-DECIMALS-001 — Detect oracle decimal mismatch in multi-feed
 * calculations.
 *
 * A price feed returns an integer scaled by its own `decimals()`; combining two
 * feeds (`collateral * price / stablePrice`, `tokenEth * ethUsd`) is only
 * meaningful once their scales are reconciled. The rule finds statements that
 * multiply/divide values read from different feeds and checks for scale
 * handling:
 *
 *   unnormalized-feed-decimals      no decimals query, scale factor or normalized
 *                                   operand at all
 *   partial-normalization           some operands were rescaled, at least one was not
 *   literal-scale-with-mixed-decimals  a literal scale factor is applied although the
 *                                   statically known feed decimals differ (advisory)
 *
 * Where decimals are statically determinable the finding reports the expected
 * and observed scale (exponents of ten): the raw result of `a * b` carries
 * `da + db` decimals and `a / b` carries `da - db`; applied scale factors
 * (`* 10 ** n`, `/ 1e8`) are summed. Decimals come from `<NAME>_DECIMALS`
 * constants whose name overlaps the feed's name, or from the `feedDecimals`
 * option; `feed.decimals()` queries count as normalization evidence only.
 *
 * Supported: Solidity 0.6 – 0.8.x, one file, intra-function. Feeds whose
 * decimals are only known at runtime yield medium-confidence findings.
 * See docs/rules/oracle-configuration-and-gas-forwarding-security.md.
 */

import {
  Diagnostic,
  OracleRead,
  RuleResult,
  SecurityFinding,
  SolFunction,
  extractContracts,
  extractFunctions,
  extractStateVars,
  findOracleReads,
  makeFinding,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-ORACLE-DECIMALS-001';

export interface DecimalMismatchOptions {
  /** Known decimals keyed by feed expression or variable name, e.g. `{ ethUsdFeed: 8 }`. */
  feedDecimals?: Record<string, number>;
  adapterMethods?: string[];
}

const SEQUENCER_RE = /(sequencer|uptime)/i;
const SCALE_EVIDENCE_RE =
  /(\bdecimals\b|\b10\s*\*\*|\b1e\d+\b|\b(SCALE|PRECISION|WAD|RAY|UNIT|FACTOR)\w*\b|\b_?(normalize|toWad|rescale|scale)\w*\s*\()/i;

interface PriceVar {
  name: string;
  feed: string;
  normalized: boolean;
}

function esc(n: string): string {
  return n.replace(/[$]/g, '\\$');
}

function has(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])`).test(text);
}

function appliedExponent(text: string): { value: number; dynamic: boolean } {
  let value = 0;
  let dynamic = false;
  const re = /([*\/])\s*(?:\(\s*)?(?:10\s*\*\*\s*(\d+)|1e(\d+))/g;
  let m: RegExpExecArray | null;
  const consumed: [number, number][] = [];
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[2] ?? m[3]);
    value += m[1] === '*' ? n : -n;
    consumed.push([m.index, m.index + m[0].length]);
  }
  const rest = consumed.reduce((t, [a, b]) => t.slice(0, a) + ' '.repeat(b - a) + t.slice(b), text);
  if (/\b10\s*\*\*\s*[\w(]|\b(SCALE|PRECISION|WAD|RAY|UNIT|FACTOR)\w*\b|\bdecimals\b/i.test(rest)) dynamic = true;
  return { value, dynamic };
}

function staticDecimals(
  feed: string,
  varName: string,
  constants: { key: string; value: number }[],
  override: Record<string, number>,
): number | undefined {
  if (override[feed] !== undefined) return override[feed];
  if (override[varName] !== undefined) return override[varName];
  const norm = feed.toLowerCase().replace(/[^a-z0-9]/g, '');
  let best: { key: string; value: number } | undefined;
  for (const c of constants) {
    if (c.key && norm.includes(c.key) && (!best || c.key.length > best.key.length)) best = c;
  }
  return best?.value;
}

function operandSigns(text: string, vars: string[]): Map<string, number> {
  const signs = new Map<string, number>();
  const ordered = vars
    .map((v) => ({ v, i: text.search(new RegExp(`(?<![\\w$.])${esc(v)}(?![\\w$])`)) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  ordered.forEach(({ v, i }, k) => {
    const before = text.slice(0, i);
    const op = /([*\/])\s*(?:u?int\d*\s*\(\s*|\(\s*)*$/.exec(before)?.[1];
    signs.set(v, k === 0 ? 1 : op === '/' ? -1 : 1);
  });
  return signs;
}

function priceVarsOf(fn: SolFunction, reads: OracleRead[], source: string): { vars: PriceVar[]; readOffsets: Set<number>; decimalsVars: Set<string> } {
  const vars: PriceVar[] = [];
  const readOffsets = new Set<number>();
  const decimalsVars = new Set<string>();
  for (const r of reads) {
    readOffsets.add(r.statement.offset);
    const name = r.roundData.answer ?? r.resultVar;
    if (name) vars.push({ name, feed: r.feed, normalized: false });
  }
  const stmts = statementsOf(fn, source);
  for (const st of stmts) {
    const d = /([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.\[\]]*\s*\.\s*decimals\s*\(\s*\)/.exec(st.text);
    if (d) decimalsVars.add(d[1]);
  }
  for (let round = 0; round < 3; round++) {
    for (const st of stmts) {
      if (readOffsets.has(st.offset)) continue;
      const m = /^(?:[A-Za-z_$][\w$.]*(?:\[\s*\d*\s*\])*\s+(?:memory\s+)?)?([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.+)$/.exec(st.text);
      if (!m || vars.some((v) => v.name === m[1]) || decimalsVars.has(m[1])) continue;
      const used = vars.filter((v) => has(m[2], v.name));
      if (used.length === 0) continue;
      const feeds = new Set(used.map((u) => u.feed));
      if (feeds.size !== 1) continue; // a combination, handled separately
      const evidence = SCALE_EVIDENCE_RE.test(m[2]) || [...decimalsVars].some((d) => has(m[2], d));
      vars.push({ name: m[1], feed: used[0].feed, normalized: used[0].normalized || evidence });
    }
  }
  return { vars, readOffsets, decimalsVars };
}

export function detectOracleDecimalMismatch(input: unknown, options: DecimalMismatchOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const constants = extractStateVars(masked, source, contracts)
    .filter((v) => /decimals/i.test(v.name) && /^\d+$/.test(v.initializer))
    .map((v) => ({ key: v.name.toLowerCase().replace(/decimals/g, '').replace(/[^a-z0-9]/g, ''), value: Number(v.initializer) }));
  const override = options.feedDecimals ?? {};
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (fn.kind !== 'function' || !fn.hasBody) continue;
    const reads = findOracleReads(fn, source, options.adapterMethods ?? []).filter((r) => !SEQUENCER_RE.test(r.feed));
    if (new Set(reads.map((r) => r.feed)).size < 2) continue;
    const { vars, readOffsets, decimalsVars } = priceVarsOf(fn, reads, source);
    const decimalsOfFeed = new Map<string, number | undefined>();
    for (const v of vars) if (!decimalsOfFeed.has(v.feed)) decimalsOfFeed.set(v.feed, staticDecimals(v.feed, v.name, constants, override));

    for (const st of statementsOf(fn, source)) {
      if (readOffsets.has(st.offset) || !/[*\/]/.test(st.text)) continue;
      const used = vars.filter((v) => has(st.text, v.name));
      const feeds = [...new Set(used.map((u) => u.feed))];
      if (feeds.length < 2) continue;
      // One representative variable per feed, in order of appearance.
      const reps = feeds.map((f) => used.find((u) => u.feed === f)!);
      const stmtEvidence = SCALE_EVIDENCE_RE.test(st.text) || [...decimalsVars].some((d) => has(st.text, d));
      const normalizedFlags = reps.map((r) => r.normalized);
      const decimals = reps.map((r) => decimalsOfFeed.get(r.feed));
      const known = decimals.every((d) => d !== undefined);
      const signs = operandSigns(st.text, reps.map((r) => r.name));
      const expected = known ? reps.reduce((t, r, i) => t + (signs.get(r.name) ?? 1) * (decimals[i] as number), 0) : undefined;
      const applied = appliedExponent(st.text);
      const differ = known && new Set(decimals).size > 1;
      const queriedUnused = decimalsVars.size > 0 && ![...decimalsVars].some((d) => has(st.text, d)) && !reps.some((r) => r.normalized);
      const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
      const detail = {
        feeds: reps.map((r, i) => ({ feed: r.feed, variable: r.name, decimals: decimals[i] ?? null, normalized: r.normalized })),
        statement: st.text.slice(0, 100),
        ...(known ? { expectedResultScaleExponent: expected } : {}),
        appliedScaleExponent: applied.dynamic ? null : applied.value,
      };
      const feedList = reps.map((r) => r.feed).join(' and ');

      if (!stmtEvidence && !normalizedFlags.some(Boolean)) {
        const isDivision = [...signs.values()].some((s) => s < 0) && ![...signs.values()].some((s, i) => i > 0 && s > 0);
        if (known && !differ && isDivision) continue; // equal scales cancel in a ratio
        findings.push(
          makeFinding(source, st.offset, {
            ...base,
            kind: 'unnormalized-feed-decimals',
            severity: 'high',
            confidence: differ ? 'high' : known ? 'medium' : 'low',
            message:
              `${fn.name}() combines prices from ${feedList} without normalizing their decimals` +
              (known ? `; the result carries 10^${expected} scale (feeds: ${decimals.join(' vs ')} decimals) but no scale factor is applied` : '; their decimals are not statically known and no scale factor, decimals() value or normalizing helper is applied') +
              '.',
            severityRationale: 'Mixing differently scaled prices mis-values collateral, debt or swaps by orders of magnitude.',
            confidenceEvidence: [
              known ? `feed decimals resolved: ${reps.map((r, i) => `${r.feed}=${decimals[i]}`).join(', ')}` : 'feed decimals not statically determinable',
              `statement: ${st.text.slice(0, 80)}`,
              queriedUnused ? `decimals() is queried (${[...decimalsVars].join(', ')}) but never applied in this calculation` : 'no decimals() query used in the calculation',
            ],
            remediation: 'Scale each price to a common precision (e.g. price * 10 ** (18 - feed.decimals())) before multiplying or dividing, and document the output precision.',
            details: { ...detail, decimalsQueriedButUnused: queriedUnused },
          }),
        );
        continue;
      }
      if (!stmtEvidence && normalizedFlags.some(Boolean) && !normalizedFlags.every(Boolean)) {
        findings.push(
          makeFinding(source, st.offset, {
            ...base,
            kind: 'partial-normalization',
            severity: 'high',
            confidence: 'medium',
            message: `${fn.name}() rescales only some operands (${reps.filter((r) => r.normalized).map((r) => r.name).join(', ')}) before combining ${feedList}; ${reps.filter((r) => !r.normalized).map((r) => r.name).join(', ')} keeps its raw feed scale.`,
            severityRationale: 'A half-normalized calculation is off by the decimals of the feed that was left raw.',
            confidenceEvidence: [`normalized: ${reps.filter((r) => r.normalized).map((r) => r.name).join(', ')}`, `raw: ${reps.filter((r) => !r.normalized).map((r) => r.name).join(', ')}`],
            remediation: 'Apply the same normalization to every feed value that enters the calculation.',
            details: detail,
          }),
        );
        continue;
      }
      if (differ && !applied.dynamic && applied.value !== 0 && !decimalsVars.size) {
        findings.push(
          makeFinding(source, st.offset, {
            ...base,
            kind: 'literal-scale-with-mixed-decimals',
            severity: 'low',
            confidence: 'medium',
            message: `${fn.name}() combines ${feedList} (${decimals.join(' vs ')} decimals) and rescales by a literal 10^${applied.value}; the result has 10^${(expected as number) + applied.value} scale. Confirm that is the intended output precision.`,
            severityRationale: 'A literal factor can only be right for one feed pair and one output precision; it silently breaks when a feed or its decimals change.',
            confidenceEvidence: [`expected raw scale 10^${expected}`, `applied scale 10^${applied.value}`, `statement: ${st.text.slice(0, 80)}`],
            remediation: 'Read feed.decimals() at call time (or assert it in the constructor) and derive the scale factors from it.',
            details: { ...detail, resultScaleExponent: (expected as number) + applied.value },
          }),
        );
      }
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
