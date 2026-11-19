/**
 * GG-ORACLE-ANSWER-001 — Validate oracle answer sign, round and timestamp checks.
 *
 * For every price read (Chainlink-style `latestRoundData` / `getRoundData`, the
 * deprecated `latestAnswer`, and custom adapters such as `getPrice`) the rule
 * traces the answer into financial use and checks the three validations a
 * consumer is expected to perform before trusting it:
 *
 *   sign        the answer is strictly positive (`answer > 0`); zero and negative
 *               values are rejected. `>= 0`, `!= 0` or `< 0` alone are *weak*
 *   round       the round is complete: `answeredInRound >= roundId` or an
 *               `updatedAt` zero check
 *   freshness   `updatedAt` is compared with `block.timestamp` (heartbeat)
 *
 * Reads whose answer never reaches a financial decision (only compared or
 * emitted), and sequencer-uptime feeds, are not flagged: their answer means
 * "up/down", not a price, and carries different constraints.
 *
 * Supported: Solidity 0.6 – 0.8.x, one file, intra-function; validation done in
 * a called helper or an inherited modifier is not seen. Custom adapter
 * semantics are unknowable statically, so adapter findings have low confidence.
 * See docs/rules/bridge-trust-and-oracle-answer-validation.md.
 */

import {
  Diagnostic,
  OracleRead,
  RuleResult,
  SecurityFinding,
  SolFunction,
  extractContracts,
  extractFunctions,
  findOracleReads,
  makeFinding,
  prepareSource,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-ORACLE-ANSWER-001';

export interface OracleAnswerOptions {
  /** Extra adapter method names to treat as price reads (e.g. `quote`, `priceOf`). */
  adapterMethods?: string[];
}

const ROUND_METHODS = new Set(['latestRoundData', 'getRoundData']);
const NON_PRICE_RE = /(sequencer|uptime|isUp\b|l2Sequencer)/i;

function esc(n: string): string {
  return n.replace(/[$]/g, '\\$');
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])`).test(text);
}

/** Does the answer variable reach a financial decision (not just a check or event)? */
function financialUse(fn: SolFunction, source: string, read: OracleRead, name: string): boolean {
  for (const st of statementsOf(fn, source)) {
    if (st.offset === read.statement.offset || !mentions(st.text, name)) continue;
    if (/^(emit|require|assert|if|else)\b/.test(st.text)) continue;
    if (/\breturn\b/.test(st.text) || /[*\/+\-]/.test(st.text.replace(/[A-Za-z_$][\w$.]*\s*\(\s*/g, '(')) || /(?<![=!<>])=(?!=)/.test(st.text) || /[A-Za-z_$][\w$.]*\s*\(/.test(st.text)) {
      return true;
    }
  }
  return false;
}

function signCheck(stmts: string[], a: string): 'good' | 'weak' | 'none' {
  const v = esc(a);
  const good = [
    new RegExp(`\\b${v}\\b\\s*(>\\s*0|<=\\s*0|>=\\s*1|<\\s*1)(?![\\d.])`),
    new RegExp(`(?<![\\d.])(0\\s*<|0\\s*>=|1\\s*<=|1\\s*>)\\s*${v}\\b`),
  ];
  const weak = [
    new RegExp(`\\b${v}\\b\\s*(>=\\s*0|!=\\s*0|==\\s*0|<\\s*0)(?![\\d.])`),
    new RegExp(`(?<![\\d.])(0\\s*(!=|==|<=|>))\\s*${v}\\b`),
    new RegExp(`toUint256\\s*\\(\\s*${v}\\s*\\)`),
  ];
  const guarded = stmts.filter((s) => /\b(require|assert|if)\b|toUint256/.test(s));
  if (guarded.some((s) => good.some((r) => r.test(s)))) return 'good';
  if (guarded.some((s) => weak.some((r) => r.test(s)))) return 'weak';
  return 'none';
}

export function detectUnvalidatedOracleAnswers(input: unknown, options: OracleAnswerOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (fn.kind !== 'function' || !fn.hasBody) continue;
    const reads = findOracleReads(fn, source, options.adapterMethods ?? []);
    if (reads.length === 0) continue;
    const stmts = statementsOf(fn, source).map((s) => s.text);
    const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };

    for (const read of reads) {
      if (NON_PRICE_RE.test(read.feed) || NON_PRICE_RE.test(fn.name)) continue;

      if (ROUND_METHODS.has(read.method)) {
        const { answer, updatedAt, answeredInRound, roundId } = read.roundData;
        if (answer && NON_PRICE_RE.test(answer)) continue;
        if (!answer || !financialUse(fn, source, read, answer)) continue;

        const sign = signCheck(stmts, answer);
        const roundOk =
          (!!answeredInRound && !!roundId && stmts.some((s) => /\b(require|assert|if)\b/.test(s) && mentions(s, answeredInRound) && mentions(s, roundId))) ||
          (!!updatedAt && stmts.some((s) => /\b(require|assert|if)\b/.test(s) && new RegExp(`\\b${esc(updatedAt)}\\b\\s*(==\\s*0|!=\\s*0|>\\s*0)|0\\s*(==|!=|<)\\s*${esc(updatedAt)}\\b`).test(s)));
        const fresh =
          !!updatedAt &&
          stmts.some(
            (s) =>
              /\b(require|assert|if)\b/.test(s) &&
              mentions(s, updatedAt) &&
              (/block\.timestamp/.test(s) || /(heartbeat|stale|maxAge|MAX_AGE|MAX_DELAY|timeout|threshold)/i.test(s)) &&
              /([<>]=?)/.test(s),
          ) ||
          /\b(isStale|_?checkStale\w*|_?requireFresh\w*)\s*\(/.test(fn.body);

        const evidence = [
          `${read.feed}.${read.method}() answer variable: ${answer}`,
          `answer flows into a financial statement`,
          `tuple elements captured: ${Object.entries(read.roundData).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        ];
        const mk = (kind: string, severity: SecurityFinding['severity'], message: string, rationale: string, remediation: string, extra: string[] = []) =>
          findings.push(
            makeFinding(source, read.offset, {
              ...base,
              kind,
              severity,
              confidence: 'high',
              message,
              severityRationale: rationale,
              confidenceEvidence: [...evidence, ...extra],
              remediation,
              details: { feed: read.feed, method: read.method, roundData: read.roundData },
            }),
          );

        if (sign === 'none') {
          mk(
            'missing-answer-sign-check',
            'high',
            `${fn.name}() uses the ${read.feed} answer without checking that it is positive; a zero or negative answer (an int256) is converted and used as a price.`,
            'A non-positive price wraps to a huge uint256 or zeroes out collateral/valuation math.',
            `Revert unless ${answer} > 0 before converting or using it.`,
            ['no require/if comparing the answer with 0 or 1'],
          );
        } else if (sign === 'weak') {
          mk(
            'weak-answer-sign-check',
            'medium',
            `${fn.name}() checks ${answer} only with >= 0, != 0, == 0 or < 0; that does not reject both zero and negative answers.`,
            'Zero or negative prices still pass one side of the check.',
            `Require ${answer} > 0 (equivalently revert on ${answer} <= 0).`,
          );
        }
        if (!roundOk) {
          mk(
            'missing-round-completeness-check',
            'medium',
            `${fn.name}() does not verify that the ${read.feed} round is complete (answeredInRound >= roundId or updatedAt != 0).`,
            'An incomplete round can return a carried-over or zero-timestamp answer.',
            'Require answeredInRound >= roundId (or updatedAt > 0) and keep both values from latestRoundData.',
            [answeredInRound ? `answeredInRound=${answeredInRound} is captured but never compared with roundId` : 'answeredInRound is discarded from the tuple'],
          );
        }
        if (!fresh) {
          mk(
            'missing-staleness-check',
            'high',
            `${fn.name}() does not check the freshness of the ${read.feed} answer (${updatedAt ? `${updatedAt} is never compared with block.timestamp` : 'updatedAt is discarded from the tuple'}).`,
            'A stale price keeps being used after the feed stops updating or the market moves.',
            `Require block.timestamp - updatedAt <= HEARTBEAT (per-feed heartbeat plus a grace period).`,
            [updatedAt ? `updatedAt=${updatedAt} has no timestamp comparison` : 'updatedAt discarded'],
          );
        }
        continue;
      }

      if (read.method === 'latestAnswer') {
        const v = read.resultVar;
        if (v && !financialUse(fn, source, read, v)) continue;
        findings.push(
          makeFinding(source, read.offset, {
            ...base,
            kind: 'deprecated-latest-answer',
            severity: 'high',
            confidence: 'high',
            message: `${fn.name}() reads ${read.feed}.latestAnswer(), which returns neither a timestamp nor a round id; sign, completeness and freshness cannot be validated.`,
            severityRationale: 'latestAnswer is deprecated by Chainlink precisely because consumers cannot detect stale or incomplete answers with it.',
            confidenceEvidence: [`call to ${read.feed}.latestAnswer()`, v ? `result ${v} reaches financial logic` : 'result is used inline'],
            remediation: 'Use latestRoundData() and validate answer > 0, answeredInRound >= roundId and block.timestamp - updatedAt <= HEARTBEAT.',
            details: { feed: read.feed, method: read.method },
          }),
        );
        continue;
      }

      // Custom adapter: semantics unknown.
      const v = read.resultVar;
      if (!v || !financialUse(fn, source, read, v)) continue;
      const positive = stmts.some((s) => /\b(require|assert|if)\b/.test(s) && mentions(s, v) && /(>\s*0|!=\s*0|==\s*0|<=\s*0)/.test(s));
      const timeAware = /(updatedAt|timestamp|stale|heartbeat|maxAge|age)/i.test(fn.body.replace(read.statement.text, ''));
      if (positive || timeAware) continue;
      findings.push(
        makeFinding(source, read.offset, {
          ...base,
          kind: 'unvalidated-adapter-price',
          severity: 'medium',
          confidence: 'low',
          message: `${fn.name}() uses the result of ${read.feed}.${read.method}() in financial logic without a zero check or any freshness handling.`,
          severityRationale: 'Adapter behavior is unknown statically; the consumer should not assume the adapter already validated its source.',
          confidenceEvidence: [`custom adapter call ${read.feed}.${read.method}()`, `no comparison of ${v} with 0`, 'no updatedAt/timestamp/stale handling in the function'],
          remediation: 'Confirm the adapter reverts on stale or invalid data, or validate the price (> 0) and its age in the consumer.',
          details: { feed: read.feed, method: read.method, result: v },
        }),
      );
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
