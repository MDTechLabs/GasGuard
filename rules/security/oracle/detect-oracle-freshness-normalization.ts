/**
 * GG-ORACLE-FRESH-001: oracle freshness and decimal-normalization defects.
 *
 * Complements GG-ORACLE-ANSWER-001 (sign and round checks) with two focused
 * questions about every price read in a function:
 *
 *   freshness      is `updatedAt` kept and compared with `block.timestamp`?
 *                  kinds: discarded-updated-at, missing-freshness-bound
 *   normalization  is the answer scaled with the feed's own decimals?
 *                  kinds: hardcoded-feed-decimals, unnormalized-feed-mix
 *
 * Supported: Solidity 0.6 - 0.8.x, single file, intra-function. A freshness
 * helper or a decimals value stored elsewhere is only recognised by name
 * (see LIMITATIONS). Reads whose answer never reaches financial logic are not
 * reported. See docs/rules/oracle-freshness-normalization.md.
 */

import {
  type Diagnostic,
  type OracleRead,
  type RuleResult,
  type SecurityFinding,
  type SolFunction,
  extractContracts,
  extractFunctions,
  findOracleReads,
  makeFinding,
  mentions,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-ORACLE-FRESH-001';

export const LIMITATIONS = [
  'Freshness checks inside a called helper are recognised only by the names isStale, checkStale and requireFresh.',
  'Decimals are considered handled when any .decimals() call appears in the source or the function; the call is not matched to a specific feed.',
  'Only Chainlink-style and named adapter reads found by the shared oracle-read helper are analyzed.',
];

const GUARD_RE = /\b(require|assert|if)\b/;
const SCALE_RE = /(?<![\w.])(1e\d+|10\s*\*\*\s*\d+|\d{1,3}(?:_\d{3})+|\d{7,})(?![\w.])|\bether\b/;
const FRESH_HELPER_RE = /\b(isStale|_?checkStale\w*|_?requireFresh\w*)\s*\(/;

function answerOf(read: OracleRead): string | undefined {
  return read.roundData.answer ?? read.resultVar;
}

function usedFinancially(fn: SolFunction, source: string, read: OracleRead, name: string): boolean {
  return statementsOf(fn, source).some(
    (s) => s.offset !== read.statement.offset && mentions(s.text, name) && !/^(emit|require|assert|if|else)\b/.test(s.text),
  );
}

export function detectOracleFreshnessNormalization(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const contracts = extractContracts(masked, diagnostics);
    const functions = extractFunctions(masked, source, contracts, diagnostics);
    const sourceReadsDecimals = /\.\s*decimals\s*\(\s*\)/.test(masked);

    for (const fn of functions) {
      if (fn.kind !== 'function' || !fn.hasBody) continue;
      const reads = findOracleReads(fn, source).filter((r) => !/(sequencer|uptime)/i.test(r.feed));
      if (reads.length === 0) continue;
      const stmts = statementsOf(fn, source);
      const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
      const decimalsInFn = /\.\s*decimals\s*\(\s*\)|\b\w*[dD]ecimals\w*\b/.test(fn.body);
      const priced: Array<{ read: OracleRead; name: string }> = [];

      for (const read of reads) {
        const name = answerOf(read);
        if (!name || !usedFinancially(fn, source, read, name)) continue;
        priced.push({ read, name });

        if (read.method === 'latestRoundData') {
          const updatedAt = read.roundData.updatedAt;
          const helper = FRESH_HELPER_RE.test(fn.body);
          const compared =
            !!updatedAt && stmts.some((s) => GUARD_RE.test(s.text) && mentions(s.text, updatedAt) && /block\.timestamp/.test(s.text));
          if (!helper && !compared) {
            findings.push(
              makeFinding(source, read.offset, {
                ...base,
                kind: updatedAt ? 'missing-freshness-bound' : 'discarded-updated-at',
                severity: 'high',
                confidence: 'high',
                message: updatedAt
                  ? `${fn.name}() keeps updatedAt from ${read.feed}.latestRoundData() but never compares it with block.timestamp, so a stale price is accepted.`
                  : `${fn.name}() discards updatedAt from ${read.feed}.latestRoundData(), so the age of the price cannot be checked.`,
                severityRationale: 'A feed that stops updating keeps returning its last answer; using it misprices collateral, swaps and liquidations.',
                confidenceEvidence: [`${read.feed}.latestRoundData() answer ${name} reaches financial logic`, updatedAt ? `updatedAt=${updatedAt} has no block.timestamp comparison` : 'updatedAt is not captured'],
                remediation: 'Capture updatedAt and require block.timestamp - updatedAt <= HEARTBEAT, with a heartbeat set per feed.',
                details: { feed: read.feed, updatedAt: updatedAt ?? null },
              }),
            );
          }
        }

        const scaled = stmts.find((s) => s.offset !== read.statement.offset && mentions(s.text, name) && SCALE_RE.test(s.text));
        if (scaled && !decimalsInFn && !sourceReadsDecimals) {
          findings.push(
            makeFinding(source, scaled.offset, {
              ...base,
              kind: 'hardcoded-feed-decimals',
              severity: 'medium',
              confidence: 'medium',
              message: `${fn.name}() scales the ${read.feed} answer with a literal factor and never reads the feed's decimals(); feeds quote 8 or 18 decimals and the assumption breaks when the feed changes.`,
              severityRationale: 'A wrong decimals assumption misprices by orders of magnitude, but it needs a feed whose decimals differ from the hard-coded value.',
              confidenceEvidence: [`answer ${name} is multiplied or divided by a literal`, 'no .decimals() call in the function or the source'],
              remediation: 'Read decimals() from the feed and scale the answer to a single internal precision.',
              details: { feed: read.feed, answer: name },
            }),
          );
        }
      }

      if (priced.length >= 2 && !decimalsInFn) {
        const mix = stmts.find(
          (s) => /[*\/]/.test(s.text) && priced.filter((p) => mentions(s.text, p.name)).length >= 2,
        );
        if (mix) {
          findings.push(
            makeFinding(source, mix.offset, {
              ...base,
              kind: 'unnormalized-feed-mix',
              severity: 'medium',
              confidence: 'medium',
              message: `${fn.name}() combines answers from ${priced.map((p) => p.read.feed).join(' and ')} in one expression without normalizing their decimals.`,
              severityRationale: 'Feeds in different quote currencies often use different decimals, so the product or ratio is off by a power of ten.',
              confidenceEvidence: [`${priced.length} feed answers are used in the function`, 'one statement multiplies or divides two of them', 'no decimals handling in the function'],
              remediation: 'Normalize every answer to a common precision with its own decimals() before combining them.',
              details: { feeds: priced.map((p) => p.read.feed) },
            }),
          );
        }
      }
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
