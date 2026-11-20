/**
 * GG-ORACLE-FALLBACK-001 — Analyze fallback oracle paths for inconsistent asset
 * semantics.
 *
 * Many price consumers read a primary feed and fall back to a second source when
 * the first fails (`try ... catch`, or a second read inside an `if` / `else`
 * block). Both sources then feed the same downstream calculation, so they must
 * agree on what the number means. The rule compares the primary and fallback
 * paths on:
 *
 *   quote asset   ETH/USD vs ETH/EUR (read from the feed identifiers)
 *   inversion     a USD/ETH feed (or `1e36 / price`) on one side only
 *   decimals      one path rescales (decimals(), 10 ** n, 1eN) and the other doesn't
 *   freshness     a staleness check (block.timestamp vs updatedAt) on one path or
 *                 with different thresholds
 *
 * Explicit adapter normalization — both paths calling a `normalize` / `toWad` /
 * `scale`-style helper — is recognized and suppresses the decimals finding.
 *
 * Supported: Solidity 0.6 – 0.8.x, one file, intra-function. Asset semantics are
 * inferred from identifier names (`ethUsdFeed`), which are a heuristic; adapters
 * and feeds configured elsewhere are not resolved. See
 * docs/rules/oracle-configuration-and-gas-forwarding-security.md.
 */

import {
  Diagnostic,
  OracleRead,
  RuleResult,
  SecurityFinding,
  extractContracts,
  extractFunctions,
  findMatching,
  findOracleReads,
  makeFinding,
  prepareSource,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-ORACLE-FALLBACK-001';

export interface FallbackOracleOptions {
  adapterMethods?: string[];
}

const ASSET_CODES = ['USDC', 'USDT', 'WBTC', 'STETH', 'USD', 'ETH', 'EUR', 'BTC', 'DAI', 'BNB', 'GBP', 'JPY'];
const NORMALIZER_RE = /\b_?(normalize|toWad|rescale|scale|adapt|convert)\w*\s*\(/;

interface Block {
  open: number;
  close: number;
  header: string;
}

interface Features {
  stale: boolean;
  staleThreshold?: string;
  decimalsQuery: boolean;
  literalScales: number[];
  normalizer?: string;
  inverts: boolean;
  assigned: string[];
  returns: boolean;
}

function enclosingBlock(body: string, rel: number): Block | undefined {
  let depth = 0;
  for (let i = rel - 1; i >= 0; i--) {
    const c = body[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        const close = findMatching(body, i);
        const before = body.slice(Math.max(0, i - 160), i);
        const header = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('}'), before.lastIndexOf('{')) + 1);
        return { open: i, close: close === -1 ? body.length : close, header };
      }
      depth--;
    }
  }
  return undefined;
}

function features(text: string): Features {
  const thresholdMatch =
    /block\.timestamp\s*-\s*[\w.]+\s*(?:<=|<|>=|>)\s*([\w.]+)/.exec(text) ??
    /[\w.]+\s*\+\s*([\w.]+)\s*(?:>=|<=|<|>)\s*block\.timestamp/.exec(text) ??
    /block\.timestamp\s*(?:<=|<|>=|>)\s*[\w.]+\s*\+\s*([\w.]+)/.exec(text);
  const stale = !!thresholdMatch || /\b(isStale|_?requireFresh\w*|_?checkStale\w*)\s*\(/.test(text);
  // `1e36 / price` is an inversion numerator, not a decimals scale factor.
  const scaleText = text.replace(/((?:=|\(|\breturn\b|,)\s*)(?:1e\d+|10\s*\*\*\s*\d+)(\s*\/)/g, '$1 $2');
  const literalScales: number[] = [];
  for (const m of scaleText.matchAll(/(?:\b1e(\d+)\b|\b10\s*\*\*\s*(\d+)\b)/g)) literalScales.push(Number(m[1] ?? m[2]));
  const assigned = [...text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]);
  return {
    stale,
    staleThreshold: thresholdMatch?.[1],
    decimalsQuery: /\.\s*decimals\s*\(\s*\)/.test(text),
    literalScales,
    normalizer: NORMALIZER_RE.exec(text)?.[0].replace(/\s*\($/, ''),
    inverts: /\b1e\d+\s*\/|\b10\s*\*\*\s*\d+\s*\/|\b(invert|inverse|reciprocal)\w*/i.test(text),
    assigned,
    returns: /\breturn\b/.test(text),
  };
}

function assetPair(feed: string): string[] {
  const upper = feed.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
  const found: { code: string; i: number }[] = [];
  for (const code of ASSET_CODES) {
    let from = 0;
    for (;;) {
      const i = upper.indexOf(code, from);
      if (i === -1) break;
      if (!found.some((f) => i < f.i + f.code.length && f.i < i + code.length)) found.push({ code, i });
      from = i + code.length;
    }
  }
  return found.sort((a, b) => a.i - b.i).map((f) => f.code);
}

function normalized(f: Features): boolean {
  return f.decimalsQuery || f.literalScales.length > 0 || !!f.normalizer;
}

export function detectFallbackOracleInconsistency(input: unknown, options: FallbackOracleOptions = {}): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const contracts = extractContracts(masked, diagnostics);
  const functions = extractFunctions(masked, source, contracts, diagnostics);
  const findings: SecurityFinding[] = [];

  for (const fn of functions) {
    if (fn.kind !== 'function' || !fn.hasBody) continue;
    const reads = findOracleReads(fn, source, options.adapterMethods ?? []).filter((r) => !/sequencer|uptime/i.test(r.feed));
    if (reads.length < 2) continue;
    const body = fn.body;
    const rel = (r: OracleRead) => r.statement.offset - fn.bodyOffset;

    for (let i = 1; i < reads.length; i++) {
      const fallback = reads[i];
      const block = enclosingBlock(body, rel(fallback));
      if (!block || !/\bcatch\b|\belse\b|\bif\s*\(/.test(block.header)) continue;
      const primary = [...reads.slice(0, i)].reverse().find((r) => r.feed !== fallback.feed && rel(r) < block.open);
      if (!primary) continue;

      // Primary segment: a try statement through its success block, otherwise up to the fallback block.
      const pStart = rel(primary);
      let pEnd = block.open;
      if (/^try\b/.test(primary.statement.text)) {
        const successOpen = body.indexOf('{', pStart + primary.statement.text.length);
        const successClose = successOpen === -1 ? -1 : findMatching(body, successOpen);
        if (successClose !== -1) pEnd = Math.min(block.open, successClose + 1);
      }
      const pText = body.slice(pStart, pEnd);
      const fText = body.slice(block.open, block.close + 1);
      const p = features(pText);
      const f = features(fText);
      const pPair = assetPair(primary.feed);
      const fPair = assetPair(fallback.feed);
      const sharedSink = p.assigned.some((a) => f.assigned.includes(a)) || (p.returns && f.returns);

      const mismatches: { kind: string; severity: SecurityFinding['severity']; why: string; remedy: string }[] = [];
      const quoteMismatch = (): void => {
        mismatches.push({
          kind: 'fallback-quote-asset-mismatch',
          severity: 'high',
          why: `primary quotes ${pPair[0]}/${pPair[1]} but the fallback quotes ${fPair[0]}/${fPair[1]}`,
          remedy: 'Use a fallback feed with the same base and quote asset, or convert it explicitly before use.',
        });
      };
      const inversionMismatch = (why: string): void => {
        mismatches.push({
          kind: 'fallback-inversion-mismatch',
          severity: 'high',
          why,
          remedy: 'Apply the same orientation to both sources (invert one explicitly, e.g. 10 ** (2 * decimals) / answer) before the shared calculation.',
        });
      };
      if (pPair.length === 2 && fPair.length === 2) {
        const same = pPair[0] === fPair[0] && pPair[1] === fPair[1];
        const reversed = pPair[0] === fPair[1] && pPair[1] === fPair[0];
        if (!same && !reversed) quoteMismatch();
        else if (reversed && p.inverts === f.inverts) {
          inversionMismatch(`the fallback feed is ${fPair[0]}/${fPair[1]} (the inverse of the primary ${pPair[0]}/${pPair[1]}) but is not inverted`);
        } else if (same && p.inverts !== f.inverts) {
          inversionMismatch(`${p.inverts ? 'the primary' : 'the fallback'} path inverts its answer (reciprocal) although both feeds have the same orientation`);
        }
      } else if (p.inverts !== f.inverts) {
        inversionMismatch(`${p.inverts ? 'the primary' : 'the fallback'} path inverts its answer (reciprocal) but the other does not`);
      }
      const bothNormalizers = !!p.normalizer && !!f.normalizer;
      if (!bothNormalizers) {
        const scalesDiffer = p.literalScales.length > 0 && f.literalScales.length > 0 && p.literalScales.join() !== f.literalScales.join();
        if (normalized(p) !== normalized(f) || scalesDiffer) {
          mismatches.push({
            kind: 'fallback-decimals-mismatch',
            severity: 'high',
            why: normalized(p) !== normalized(f)
              ? `${normalized(p) ? 'the primary' : 'the fallback'} path rescales by decimals/scale factors and the other does not`
              : `the paths apply different scale factors (${p.literalScales.join(', ')} vs ${f.literalScales.join(', ')})`,
            remedy: 'Normalize both sources through one adapter that reads each feed\'s decimals() before the shared calculation.',
          });
        }
      }
      if (p.stale && !f.stale) {
        mismatches.push({
          kind: 'fallback-stale-policy-mismatch',
          severity: 'high',
          why: 'the primary path rejects stale answers but the fallback path accepts any age',
          remedy: 'Apply a staleness check (block.timestamp - updatedAt <= heartbeat) to the fallback as well.',
        });
      } else if (p.stale && f.stale && p.staleThreshold && f.staleThreshold && p.staleThreshold !== f.staleThreshold) {
        mismatches.push({
          kind: 'fallback-stale-policy-mismatch',
          severity: 'medium',
          why: `the paths use different staleness thresholds (${p.staleThreshold} vs ${f.staleThreshold})`,
          remedy: 'Use a per-feed heartbeat that matches each feed\'s documented update frequency, and document why they differ.',
        });
      }

      for (const m of mismatches) {
        findings.push(
          makeFinding(source, fallback.offset, {
            ruleId: RULE_ID,
            kind: m.kind,
            severity: m.severity,
            confidence: sharedSink ? 'high' : 'medium',
            contract: fn.contract,
            function: fn.name,
            message: `${fn.name}() falls back from ${primary.feed} to ${fallback.feed}, but ${m.why}.`,
            severityRationale: 'When the primary source fails, the fallback silently changes the meaning or precision of the number that drives the same financial decision.',
            confidenceEvidence: [
              `primary ${primary.feed}.${primary.method}() and fallback ${fallback.feed}.${fallback.method}() (${block.header.trim().slice(0, 30) || 'conditional block'})`,
              sharedSink ? 'both paths assign the same result variable or return' : 'no shared result variable was resolved',
              `primary: stale=${p.stale} decimals=${normalized(p)} inverts=${p.inverts}; fallback: stale=${f.stale} decimals=${normalized(f)} inverts=${f.inverts}`,
            ],
            remediation: m.remedy,
            details: {
              primary: { feed: primary.feed, pair: pPair, stale: p.stale, staleThreshold: p.staleThreshold ?? null, normalized: normalized(p), inverts: p.inverts },
              fallback: { feed: fallback.feed, pair: fPair, stale: f.stale, staleThreshold: f.staleThreshold ?? null, normalized: normalized(f), inverts: f.inverts },
              sharedSink,
            },
          }),
        );
      }
    }
  }
  findings.sort((a, b) => a.line - b.line);
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
