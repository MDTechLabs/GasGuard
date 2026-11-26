/**
 * GG-DEX-SLIPPAGE-001: missing slippage bounds in token exchange operations.
 *
 * Inspects calls to common swap and liquidity entry points (Uniswap V2 router,
 * Uniswap V3 router params, Curve `exchange`) and classifies the bound that
 * protects the caller:
 *
 *   zero-min-output          the minimum output is the literal 0
 *   unbounded-max-input      the maximum input is type(uintN).max
 *   onchain-derived-bound    the bound is computed in the same transaction from a
 *                            spot quote (getAmountsOut, getReserves, slot0), which
 *                            a sandwich attacker can move together with the swap
 *   immediate-deadline       the deadline is block.timestamp, which never expires
 *
 * Bounds that come from a parameter or storage are accepted. Supported:
 * Solidity 0.6 - 0.8.x, single file, intra-function. Aggregator and custom
 * pool interfaces are not analyzed. See docs/rules/dex-missing-slippage-bounds.md.
 */

import {
  type Diagnostic,
  type RuleResult,
  type SecurityFinding,
  extractContracts,
  extractFunctions,
  findMatching,
  makeFinding,
  mentions,
  prepareSource,
  splitTopLevel,
  statementsOf,
} from '../lib/solidity-lite';

export const RULE_ID = 'GG-DEX-SLIPPAGE-001';

export const LIMITATIONS = [
  'Only the Uniswap V2 router, Uniswap V3 router struct params and Curve exchange call shapes are recognised.',
  'A bound validated after the swap (comparing the returned amount) is not recognised and can be reported.',
  'Bounds passed through a helper function are not followed.',
];

type Bound = 'min-out' | 'max-in';

interface CallShape {
  method: string;
  bound?: { index: number; kind: Bound };
  deadlineIndex?: number;
}

const SHAPES: CallShape[] = [
  { method: 'swapExactTokensForTokens', bound: { index: 1, kind: 'min-out' }, deadlineIndex: 4 },
  { method: 'swapExactTokensForETH', bound: { index: 1, kind: 'min-out' }, deadlineIndex: 4 },
  { method: 'swapExactETHForTokens', bound: { index: 0, kind: 'min-out' }, deadlineIndex: 3 },
  { method: 'swapTokensForExactTokens', bound: { index: 1, kind: 'max-in' }, deadlineIndex: 4 },
  { method: 'swapTokensForExactETH', bound: { index: 1, kind: 'max-in' }, deadlineIndex: 4 },
  { method: 'swapETHForExactTokens', deadlineIndex: 3 },
  { method: 'exchange', bound: { index: 3, kind: 'min-out' } },
  { method: 'exchange_underlying', bound: { index: 3, kind: 'min-out' } },
];

const STRUCT_METHODS = ['exactInputSingle', 'exactInput', 'exactOutputSingle', 'exactOutput'];
const QUOTE_RE = /\b(getAmountsOut|getAmountOut|getReserves|slot0|quoteExactInput\w*|quoteExactOutput\w*)\s*\(/;
const ZERO_RE = /^(0|0x0+|uint\d*\s*\(\s*0\s*\))$/;
const MAX_RE = /^type\s*\(\s*uint\d*\s*\)\s*\.max$|^~\s*uint\d*\s*\(\s*0\s*\)$/;
const NOW_RE = /^block\.timestamp$/;

export function detectMissingSlippageBounds(input: unknown): RuleResult {
  const prep = prepareSource(input);
  if (!prep.ok) return { ruleId: RULE_ID, analyzed: false, findings: [], diagnostics: prep.diagnostics };
  const { source, masked } = prep.prepared;
  const diagnostics: Diagnostic[] = [...prep.diagnostics];
  const findings: SecurityFinding[] = [];

  try {
    const contracts = extractContracts(masked, diagnostics);
    const functions = extractFunctions(masked, source, contracts, diagnostics);

    for (const fn of functions) {
      if (fn.kind !== 'function' || !fn.hasBody) continue;
      const stmts = statementsOf(fn, source);
      const quoted = new Set<string>();
      for (const s of stmts) {
        const a = /([A-Za-z_$][\w$]*)\s*=\s*[^;]*/.exec(s.text);
        if (a && QUOTE_RE.test(s.text)) quoted.add(a[1]);
      }
      const base = { ruleId: RULE_ID, contract: fn.contract, function: fn.name };
      const derivedFromQuote = (expr: string) => QUOTE_RE.test(expr) || [...quoted].some((q) => mentions(expr, q));

      const report = (offset: number, kind: string, severity: SecurityFinding['severity'], message: string, rationale: string, evidence: string[], remediation: string, method: string) =>
        findings.push(
          makeFinding(source, offset, {
            ...base,
            kind,
            severity,
            confidence: kind === 'immediate-deadline' ? 'medium' : 'high',
            message,
            severityRationale: rationale,
            confidenceEvidence: evidence,
            remediation,
            details: { method },
          }),
        );

      const check = (offset: number, method: string, expr: string, kind: Bound | null) => {
        const e = expr.trim();
        if (kind === 'min-out') {
          if (ZERO_RE.test(e)) {
            report(offset, 'zero-min-output', 'high', `${fn.name}() calls ${method} with a minimum output of 0, so the swap executes at any price and can be sandwiched.`, 'A zero floor lets an attacker move the pool price and take the difference from the caller.', [`${method} minimum output is the literal ${e}`], 'Accept a minimum output from the caller (or a trusted oracle) and revert below it.', method);
          } else if (derivedFromQuote(e)) {
            report(offset, 'onchain-derived-bound', 'medium', `${fn.name}() derives the minimum output of ${method} from a spot quote read in the same transaction; the quote moves with the manipulated pool.`, 'A bound computed from the same pool state gives no protection against a sandwich around the swap.', [`${method} bound mentions a spot quote or a variable computed from one`], 'Take the bound from the caller or from a time-weighted or external price.', method);
          }
        } else if (kind === 'max-in' && MAX_RE.test(e)) {
          report(offset, 'unbounded-max-input', 'high', `${fn.name}() calls ${method} with an unlimited maximum input, so the caller can be charged any amount.`, 'An unbounded input cap removes the only price protection of an exact-output swap.', [`${method} maximum input is ${e}`], 'Pass a caller-supplied maximum input and revert above it.', method);
        }
      };

      const checkDeadline = (offset: number, method: string, expr: string) => {
        if (NOW_RE.test(expr.trim())) {
          report(offset, 'immediate-deadline', 'low', `${fn.name}() passes block.timestamp as the deadline of ${method}, which is always satisfied.`, 'The deadline cannot protect against a transaction that is held and executed later at a worse price.', [`${method} deadline is block.timestamp`], 'Pass a caller-supplied deadline and require it to be in the future.', method);
        }
      };

      for (const shape of SHAPES) {
        const re = new RegExp(`\\.\\s*${shape.method}\\s*\\(`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(fn.body)) !== null) {
          const open = m.index + m[0].length - 1;
          const close = findMatching(fn.body, open, '(', ')');
          if (close === -1) break;
          const args = splitTopLevel(fn.body.slice(open + 1, close)).map((a) => a.trim());
          const offset = fn.bodyOffset + m.index;
          if (shape.bound && args[shape.bound.index] !== undefined) check(offset, shape.method, args[shape.bound.index], shape.bound.kind);
          if (shape.deadlineIndex !== undefined && args[shape.deadlineIndex] !== undefined) checkDeadline(offset, shape.method, args[shape.deadlineIndex]);
          re.lastIndex = close;
        }
      }

      for (const method of STRUCT_METHODS) {
        const re = new RegExp(`\\.\\s*${method}\\s*\\(`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(fn.body)) !== null) {
          const offset = fn.bodyOffset + m.index;
          const out = /amountOutMinimum\s*:\s*([^,}]+)/.exec(fn.body);
          const inMax = /amountInMaximum\s*:\s*([^,}]+)/.exec(fn.body);
          const deadline = /deadline\s*:\s*([^,}]+)/.exec(fn.body);
          if (out && method.startsWith('exactInput')) check(offset, method, out[1], 'min-out');
          if (inMax && method.startsWith('exactOutput')) check(offset, method, inMax[1], 'max-in');
          if (deadline) checkDeadline(offset, method, deadline[1]);
        }
      }
    }
  } catch {
    diagnostics.push({ level: 'error', code: 'internal-error', message: 'Analysis stopped on unsupported input; findings may be incomplete.' });
  }

  findings.sort((a, b) => a.line - b.line || a.column - b.column || a.kind.localeCompare(b.kind));
  return { ruleId: RULE_ID, analyzed: true, findings, diagnostics };
}
