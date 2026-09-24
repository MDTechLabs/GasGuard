/**
 * Soroban Authorization Propagation Analyzer (Issue #919)
 *
 * Detects cross-contract calls where the required authorization context is
 * not properly propagated. A cross-contract client call that acts on an
 * Address-derived argument (e.g. `client.transfer(&from, ...)`) must be
 * accompanied by an authorization in the calling function (`require_auth`,
 * `require_auth_for_args`, `check_auth`) or by an explicit authorization
 * propagation mechanism (`with_auth`, `invoke_contract_check_auth`).
 * Missing propagation makes the call fail at runtime — or silently skip the
 * intended authorization — and the analyzer reports the affected call path.
 */

import {
  maskNonCode,
  createLineResolver,
  extractFunctions,
  extractArgs,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

export interface AuthCallSite {
  caller: string;
  /** Client variable + method, e.g. "client.transfer". */
  callee: string;
  line: number;
  /** Normalized argument expressions of the cross-contract call. */
  args: string[];
}

export interface AuthPropagationFinding {
  rule: 'soroban-missing-auth-propagation';
  line: number;
  caller: string;
  callee: string;
  /** Human-readable call path, e.g. "pay_out -> client.transfer". */
  callPath: string;
  /** Arguments that look Address-derived and need authorization context. */
  addressArgs: string[];
  message: string;
  suggestion: string;
  severity: 'high' | 'medium';
}

export interface AuthPropagationReport {
  findings: AuthPropagationFinding[];
  summary: string;
  metrics: {
    crossContractCalls: number;
    authedFunctions: number;
    flaggedCallPaths: number;
  };
}

/**
 * Mechanisms that establish or propagate authorization context. A function
 * containing any of these is considered to propagate authorization into its
 * cross-contract calls.
 */
const AUTH_PROPAGATION =
  /require_auth\s*\(|require_auth_for_args\s*\(|\.authenticate\s*\(|check_auth\s*\(|with_auth\s*\(|invoke_contract_check_auth\s*\(|with_source_account\s*\(|authorize_as_curr_contract\s*\(/;

/** Local Address creation — such args do not need incoming authorization. */
const LOCAL_ADDRESS =
  /Address::generate\s*\(|Address::from_string|Address::from_contract_id|\.address\s*\(\s*\)/;

/** Client bindings that introduce a cross-contract client variable. */
const CLIENT_BINDING =
  /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[A-Za-z0-9_:]*Client\s*::\s*new\s*\(/;

/** Cross-contract client call sites: `client.method(args)`. */
const CLIENT_CALL = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/** Client methods that only read state — no authorization propagation needed. */
const READ_METHOD =
  /^(get_|is_|has_|balance_|total_|view_|query_|read_|list_|fetch_|decimals|name|symbol|version|seq)/;

export function analyzeAuthPropagation(source: string): AuthPropagationReport {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const functions = extractFunctions(masked, source);

  const findings: AuthPropagationFinding[] = [];
  let crossContractCalls = 0;

  for (const fn of functions) {
    const bodyOriginal = source.slice(fn.bodyStart, fn.bodyEnd);
    const bodyMasked = masked.slice(fn.bodyStart, fn.bodyEnd);
    const fnHasAuth = AUTH_PROPAGATION.test(bodyOriginal);

    // Collect client variables bound in this function, e.g.
    // `let client = token::Client::new(&env, &token_id);`
    const clientVars = new Set<string>();
    let binding: RegExpExecArray | null;
    const bindingRe = new RegExp(CLIENT_BINDING.source, 'g');
    while ((binding = bindingRe.exec(bodyOriginal)) !== null) {
      clientVars.add(binding[1]);
    }
    if (clientVars.size === 0) continue;

    // Scan client call sites in the (masked) function body.
    CLIENT_CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLIENT_CALL.exec(bodyMasked)) !== null) {
      const clientVar = m[1];
      if (!clientVars.has(clientVar)) continue;

      crossContractCalls++;

      // Read-only client methods do not require authorization propagation.
      if (READ_METHOD.test(m[2])) continue;

      const dotOffset = fn.bodyStart + m.index;
      const openParen = masked.indexOf('(', dotOffset + m[0].length - 1);
      if (openParen === -1) continue;
      const args = splitArgs(extractArgs(masked, source, openParen).text);
      const addressArgs = args.filter(
        (a) => !LOCAL_ADDRESS.test(a) && looksLikeAddressArg(a, source),
      );
      if (addressArgs.length === 0) continue;

      if (fnHasAuth) continue;

      const callee = `${clientVar}.${m[2]}`;
      findings.push({
        rule: 'soroban-missing-auth-propagation',
        line: lineOf(dotOffset),
        caller: fn.name,
        callee,
        callPath: `${fn.name} -> ${callee}`,
        addressArgs,
        message:
          `Cross-contract call '${callee}' in '${fn.name}' passes Address-derived argument(s) ` +
          `(${addressArgs.join(', ')}) without propagating authorization — the call may fail at ` +
          `runtime or bypass the intended authorization.`,
        suggestion:
          `Add \`require_auth()\` (or \`require_auth_for_args\`) for the authorizing Address in ` +
          `'${fn.name}', or wrap the invocation with \`with_auth\` / ` +
          `\`invoke_contract_check_auth\` so the authorization context reaches the callee.`,
        severity: 'high',
      });
    }
  }

  const authedFunctions = functions.filter((f) =>
    AUTH_PROPAGATION.test(source.slice(f.bodyStart, f.bodyEnd)),
  ).length;

  return {
    findings,
    summary:
      findings.length === 0
        ? `Authorization context is propagated across all ${crossContractCalls} cross-contract call(s).`
        : `Found ${findings.length} cross-contract call path(s) with missing authorization propagation.`,
    metrics: {
      crossContractCalls,
      authedFunctions,
      flaggedCallPaths: findings.length,
    },
  };
}

/**
 * Heuristic: the argument references a variable that holds an Address.
 * Symbol/string/number literals and local Address constructions are not
 * authorization subjects. Declarations are searched across the full source
 * so function-signature parameters (`fn f(env: Env, from: Address, ...)`)
 * are recognized too.
 */
function looksLikeAddressArg(arg: string, source: string): boolean {
  const normalized = normalizeExpr(arg);
  if (!normalized) return false;

  // Symbol/num/string literals are not authorization subjects.
  if (/^["']|^Symbol|::new\(/.test(normalized)) return false;

  const identifier = normalized.replace(/^&/, '').split('.')[0];
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) return false;

  // The identifier must be Address-typed or Address-derived in the contract.
  const typedDecl = new RegExp(
    `\\b(?:let|,|\\()\\s*${identifier}\\s*:\\s*Address\\b`,
  );
  const fromAddress = new RegExp(
    `\\b(?:let\\s+)?${identifier}\\s*=\\s*&?[A-Za-z0-9_]*\\.(?:address|to_address)\\b`,
  );
  return typedDecl.test(source) || fromAddress.test(source);
}

export class AuthPropagationAnalyzer {
  public static readonly RULE_ID = 'soroban-missing-auth-propagation';

  analyze(source: string): AuthPropagationReport {
    return analyzeAuthPropagation(source);
  }
}
