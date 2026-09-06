/**
 * Issue #897 — Detect Unchecked Authentication Parameters
 *
 * Detects authentication inputs in Soroban smart contracts that are used to gate
 * or execute privileged operations without sufficient preceding validation.
 * Flags missing require_auth calls and order-of-execution hazards (checks occurring
 * after privileged use).
 */

import {
  maskNonCode,
  extractFunctions as extractCommonFunctions,
  createLineResolver,
  splitArgs,
  normalizeExpr,
} from '../common/source-utils';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface UncheckedAuthParamFinding {
  ruleId: 'soroban-unchecked-auth-parameter';
  rule: 'A4-unchecked-auth-param';
  severity: Severity;
  line: number;
  functionName: string;
  parameterName: string;
  message: string;
  suggestion: string;
  location: {
    line: number;
    functionName: string;
    column?: number;
  };
  details: {
    functionName: string;
    parameterName: string;
    issueType: 'missing_validation' | 'checked_after_use';
    privilegedUseLine: number;
    validationLine?: number;
    privilegedAction: string;
  };
}

export interface UncheckedAuthParamReport {
  findings: UncheckedAuthParamFinding[];
  metrics: {
    totalAuthParameters: number;
    uncheckedParameters: number;
    misorderedChecks: number;
    validatedParameters: number;
  };
}

export interface FunctionParam {
  name: string;
  typeName: string;
  isAddress: boolean;
  isAuthCandidate: boolean;
}

export interface ParsedFunction {
  name: string;
  startLine: number;
  fnStartOffset: number;
  bodyStartOffset: number;
  bodyEndOffset: number;
  header: string;
  body: string;
  params: FunctionParam[];
  isSensitive: boolean;
}

/** Names / attributes treated as intentionally public getters (false-positive reduction). */
const PUBLIC_ALLOWLIST =
  /\b(get_|read_|view_|query_|list_|fetch_|is_|has_|balance_of|total_|version|name|symbol|decimals)\w*\b/i;

const PUBLIC_ATTR = /#\[\s*(view|readonly|public|contractmeta|contractevent)\s*\]/i;

/** Parameter names strongly indicating authentication roles. */
const AUTH_PARAM_NAMES =
  /\b(from|caller|owner|admin|sender|user|account|signer|auth|authority|delegator|initiator|operator|spender|payer|guardian|master|source)\b/i;

/** Parameter names representing passive recipients / new values / non-authorizing targets. */
const RECIPIENT_PARAM_NAMES =
  /\b(to|recipient|receiver|target|dest|destination|new_\w+|new[A-Z]\w*)\b/i;

/** State mutation indicators in Soroban. */
const STORAGE_WRITE_RE =
  /(?:env\s*\.\s*)?storage\s*\(\s*\)\s*\.\s*(?:instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(?:set|remove|update|extend_ttl)\s*\(/g;

/** General sensitive function names. */
const SENSITIVE_FN_NAME =
  /\b(set|update|write|store|mint|burn|transfer|withdraw|deposit|approve|revoke|pause|unpause|upgrade|admin|init|initialize|create|delete|remove|claim|stake|unstake|execute|finalize)\w*\b/i;

/**
 * Extracts functions, attributes, signatures, and typed parameters from Soroban Rust source.
 */
export function extractContractFunctions(source: string): ParsedFunction[] {
  const masked = maskNonCode(source);
  const lineOf = createLineResolver(source);
  const rawBlocks = extractCommonFunctions(masked, source);
  const functions: ParsedFunction[] = [];

  const fnSignatureRe = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;

  for (const block of rawBlocks) {
    fnSignatureRe.lastIndex = 0;
    // Find the signature right before bodyStart
    const preBody = masked.slice(Math.max(0, block.bodyStart - 300), block.bodyStart);
    const attrWindow = source.slice(Math.max(0, block.bodyStart - 400), block.bodyStart);

    let match: RegExpExecArray | null;
    let foundSig: { name: string; paramsRaw: string; sigOffset: number } | null = null;

    while ((match = fnSignatureRe.exec(preBody)) !== null) {
      if (match[1] === block.name) {
        foundSig = {
          name: match[1],
          paramsRaw: match[2],
          sigOffset: Math.max(0, block.bodyStart - 300) + match.index,
        };
      }
    }

    const params: FunctionParam[] = [];
    if (foundSig) {
      const rawParamList = splitArgs(foundSig.paramsRaw);
      for (const rawParam of rawParamList) {
        // Parse "name: Type" or "mut name: Type"
        const parts = rawParam.split(':');
        if (parts.length < 2) continue;

        const name = parts[0].replace(/\bmut\s+/, '').trim();
        const typeName = parts.slice(1).join(':').trim();

        if (name === 'env' || name === '&env' || name === '_env' || name === 'self' || name === '&self') {
          continue;
        }

        const isAddress = /\bAddress\b/.test(typeName) || /^&?Address\b/.test(typeName);
        const isAuthCandidate =
          isAddress ||
          AUTH_PARAM_NAMES.test(name) ||
          (!RECIPIENT_PARAM_NAMES.test(name) && isAddress);

        params.push({
          name,
          typeName,
          isAddress,
          isAuthCandidate,
        });
      }
    }

    const fnBody = source.slice(block.bodyStart, block.bodyEnd);
    const isPublic = PUBLIC_ALLOWLIST.test(block.name) || PUBLIC_ATTR.test(attrWindow);
    const isTest = /^test_/.test(block.name);
    const hasStorageWrite = /storage\s*\(\s*\)\s*\.\s*(?:instance|persistent|temporary)\s*\(\s*\)\s*\.\s*(?:set|remove|update)/.test(fnBody);
    const isSensitive = !isPublic && !isTest && (SENSITIVE_FN_NAME.test(block.name) || hasStorageWrite);

    functions.push({
      name: block.name,
      startLine: block.line,
      fnStartOffset: foundSig ? foundSig.sigOffset : block.bodyStart,
      bodyStartOffset: block.bodyStart,
      bodyEndOffset: block.bodyEnd,
      header: attrWindow,
      body: fnBody,
      params,
      isSensitive,
    });
  }

  return functions;
}

interface ValidationCheckSite {
  paramName: string;
  offset: number;
  line: number;
  kind: string;
}

interface PrivilegedUsageSite {
  paramName: string;
  offset: number;
  line: number;
  actionDescription: string;
}

/**
 * Finds all validation / authorization checks on a parameter within a function body.
 */
function findValidationChecks(
  paramName: string,
  fnBody: string,
  bodyStartOffset: number,
  lineOf: (offset: number) => number,
): ValidationCheckSite[] {
  const checks: ValidationCheckSite[] = [];
  const p = escapeRegex(paramName);

  const patterns: Array<{ re: RegExp; kind: string }> = [
    // param.require_auth() or param.require_auth_for_args(...)
    {
      re: new RegExp(`\\b${p}\\s*\\.\\s*(require_auth|require_auth_for_args)\\s*\\(`, 'g'),
      kind: 'require_auth',
    },
    // require_auth(&param) or env.require_auth(&param)
    {
      re: new RegExp(`(?:env\\s*\\.\\s*)?require_auth(?:_for_args)?\\s*\\(\\s*&?\\s*${p}\\b`, 'g'),
      kind: 'require_auth_call',
    },
    // auth.authenticate(&param) or check_auth(&param) or assert_auth(&param)
    {
      re: new RegExp(`(?:auth\\s*\\.\\s*)?(?:authenticate|check_auth|assert_auth|authorize_as_parent)\\s*\\(\\s*&?\\s*${p}\\b`, 'g'),
      kind: 'auth_helper',
    },
    // Equality checks / assertions:
    // assert!(param == admin) / assert_eq!(param, admin) / if param == admin / if param != admin
    {
      re: new RegExp(`\\bassert_eq!\\s*\\(\\s*&?\\s*${p}\\b`, 'g'),
      kind: 'assert_eq',
    },
    {
      re: new RegExp(`\\bassert_eq!\\s*\\([^,]+,\\s*&?\\s*${p}\\b`, 'g'),
      kind: 'assert_eq',
    },
    {
      re: new RegExp(`(?:assert!|if)\\s*\\(?\\s*&?\\s*${p}\\s*(?:==|!=)`, 'g'),
      kind: 'equality_check',
    },
    {
      re: new RegExp(`(?:assert!|if)\\s*\\([^)]*(?:==|!=)\\s*&?\\s*${p}\\b`, 'g'),
      kind: 'equality_check',
    },
    // Custom auth guard: is_authorized(&param) or has_role(&param)
    {
      re: new RegExp(`\\b(?:is_authorized|has_role|is_admin|check_permission)\\s*\\(\\s*&?\\s*${p}\\b`, 'g'),
      kind: 'role_check',
    },
    // Cryptographic signature verification: crypto.ed25519_verify(..., &param, ...) or verify_sig(&param, ...)
    {
      re: new RegExp(`(?:ed25519_verify|secp256k1_[A-Za-z0-9_]+|verify_signature|verify_sig)\\s*\\([^)]*&?\\s*${p}\\b`, 'g'),
      kind: 'signature_verify',
    },
  ];

  for (const { re, kind } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fnBody)) !== null) {
      const absOffset = bodyStartOffset + m.index;
      checks.push({
        paramName,
        offset: absOffset,
        line: lineOf(absOffset),
        kind,
      });
    }
  }

  return checks.sort((a, b) => a.offset - b.offset);
}

/**
 * Finds privileged / sensitive actions where the parameter is acting as authorizer or source.
 */
function findPrivilegedUsages(
  param: FunctionParam,
  fn: ParsedFunction,
  source: string,
  lineOf: (offset: number) => number,
): PrivilegedUsageSite[] {
  const usages: PrivilegedUsageSite[] = [];
  const fnBody = fn.body;
  const p = escapeRegex(param.name);

  // 1. Token transfer/burn where param is the source/debited account:
  // e.g. client.transfer(&from, &to, &amount) or token.burn(&from, &amount)
  const tokenOpPatterns = [
    {
      re: new RegExp(`\\.\\s*(?:transfer|transfer_from|burn)\\s*\\(\\s*&?\\s*${p}\\b`, 'g'),
      desc: `Token debit/transfer from '${param.name}'`,
    },
    {
      re: new RegExp(`token::Client::[^;]+\\.\\s*(?:transfer|transfer_from|burn)\\s*\\(\\s*&?\\s*${p}\\b`, 'g'),
      desc: `Token client transfer from '${param.name}'`,
    },
  ];

  for (const { re, desc } of tokenOpPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fnBody)) !== null) {
      const absOffset = fn.bodyStartOffset + m.index;
      usages.push({
        paramName: param.name,
        offset: absOffset,
        line: lineOf(absOffset),
        actionDescription: desc,
      });
    }
  }

  // 2. Sensitive state storage writes gated or parameterized by param:
  // e.g. env.storage().instance().set(&DataKey::Admin, &param) or modifying state when param is caller/admin
  const isAuthRoleName = AUTH_PARAM_NAMES.test(param.name);
  if (fn.isSensitive || isAuthRoleName) {
    STORAGE_WRITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = STORAGE_WRITE_RE.exec(fnBody)) !== null) {
      const absOffset = fn.bodyStartOffset + m.index;
      usages.push({
        paramName: param.name,
        offset: absOffset,
        line: lineOf(absOffset),
        actionDescription: `State modification in sensitive function '${fn.name}'`,
      });
    }
  }

  // 3. Admin / role updates or privileged invocations
  const privilegedCallRe = new RegExp(`\\b(?:set_admin|update_admin|pause|unpause|upgrade|mint|withdraw|emergency_withdraw)\\s*\\(`, 'g');
  let pm: RegExpExecArray | null;
  while ((pm = privilegedCallRe.exec(fnBody)) !== null) {
    const absOffset = fn.bodyStartOffset + pm.index;
    usages.push({
      paramName: param.name,
      offset: absOffset,
      line: lineOf(absOffset),
      actionDescription: `Privileged function invocation '${pm[0].replace('(', '')}'`,
    });
  }

  // Deduplicate usages at the same line
  const uniqueUsages: PrivilegedUsageSite[] = [];
  const seenLines = new Set<number>();

  for (const u of usages.sort((a, b) => a.offset - b.offset)) {
    if (!seenLines.has(u.line)) {
      seenLines.add(u.line);
      uniqueUsages.push(u);
    }
  }

  return uniqueUsages;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyzes Soroban smart contract source code for unchecked authentication parameters.
 */
export function analyzeUncheckedAuthParameters(sourceCode: string): UncheckedAuthParamReport {
  const functions = extractContractFunctions(sourceCode);
  const lineOf = createLineResolver(sourceCode);
  const findings: UncheckedAuthParamFinding[] = [];

  let totalAuthParameters = 0;
  let uncheckedParameters = 0;
  let misorderedChecks = 0;
  let validatedParameters = 0;

  for (const fn of functions) {
    // Skip view/read-only functions
    if (!fn.isSensitive && PUBLIC_ALLOWLIST.test(fn.name)) {
      continue;
    }

    for (const param of fn.params) {
      // Determine if parameter is an authentication parameter candidate
      // We skip parameters that are clearly passive recipients unless they are being debited
      if (RECIPIENT_PARAM_NAMES.test(param.name) && !AUTH_PARAM_NAMES.test(param.name)) {
        // Recipient target in transfer: check if it's used as debited source
        const isDebited = new RegExp(`\\.\\s*(?:transfer|transfer_from|burn)\\s*\\(\\s*&?\\s*${escapeRegex(param.name)}\\b`).test(fn.body);
        if (!isDebited) {
          continue;
        }
      }

      if (!param.isAuthCandidate && !param.isAddress) {
        continue;
      }

      // Check if parameter is a token contract instance parameter (e.g. token: Address passed into Client::new)
      if (param.name === 'token' || param.name === 'token_address') {
        const isOnlyTokenClient = new RegExp(`Client::new\\s*\\([^)]*&?\\s*${escapeRegex(param.name)}\\b`).test(fn.body);
        const isDebited = new RegExp(`\\.\\s*transfer\\s*\\(\\s*&?\\s*${escapeRegex(param.name)}\\b`).test(fn.body);
        if (isOnlyTokenClient && !isDebited) {
          continue;
        }
      }

      const validationChecks = findValidationChecks(param.name, fn.body, fn.bodyStartOffset, lineOf);
      const privilegedUsages = findPrivilegedUsages(param, fn, sourceCode, lineOf);

      // If no privileged actions in this function, no auth required
      if (privilegedUsages.length === 0) {
        continue;
      }

      totalAuthParameters++;

      const firstValidation = validationChecks[0];
      const firstPrivilegedUse = privilegedUsages[0];

      if (!firstValidation) {
        // Missing validation entirely
        uncheckedParameters++;
        findings.push({
          ruleId: 'soroban-unchecked-auth-parameter',
          rule: 'A4-unchecked-auth-param',
          severity: 'high',
          line: firstPrivilegedUse.line,
          functionName: fn.name,
          parameterName: param.name,
          message:
            `Authentication parameter '${param.name}' in '${fn.name}' is used in privileged operation ` +
            `(${firstPrivilegedUse.actionDescription}) at line ${firstPrivilegedUse.line} without validation.`,
          suggestion:
            `Add \`${param.name}.require_auth()\` (or an explicit authorization check) at the entry of ` +
            `'${fn.name}' before executing privileged operations.`,
          location: {
            line: firstPrivilegedUse.line,
            functionName: fn.name,
          },
          details: {
            functionName: fn.name,
            parameterName: param.name,
            issueType: 'missing_validation',
            privilegedUseLine: firstPrivilegedUse.line,
            privilegedAction: firstPrivilegedUse.actionDescription,
          },
        });
      } else if (firstPrivilegedUse.offset < firstValidation.offset) {
        // Order hazard: Privileged action executed BEFORE validation check!
        misorderedChecks++;
        findings.push({
          ruleId: 'soroban-unchecked-auth-parameter',
          rule: 'A4-unchecked-auth-param',
          severity: 'high',
          line: firstPrivilegedUse.line,
          functionName: fn.name,
          parameterName: param.name,
          message:
            `Authentication parameter '${param.name}' in '${fn.name}' is used in a privileged operation at line ` +
            `${firstPrivilegedUse.line} before being authorized at line ${firstValidation.line}.`,
          suggestion:
            `Move the authorization check \`${param.name}.require_auth()\` from line ${firstValidation.line} ` +
            `to the beginning of '${fn.name}' prior to line ${firstPrivilegedUse.line}.`,
          location: {
            line: firstPrivilegedUse.line,
            functionName: fn.name,
          },
          details: {
            functionName: fn.name,
            parameterName: param.name,
            issueType: 'checked_after_use',
            privilegedUseLine: firstPrivilegedUse.line,
            validationLine: firstValidation.line,
            privilegedAction: firstPrivilegedUse.actionDescription,
          },
        });
      } else {
        // Properly validated before privileged use
        validatedParameters++;
      }
    }
  }

  return {
    findings,
    metrics: {
      totalAuthParameters,
      uncheckedParameters,
      misorderedChecks,
      validatedParameters,
    },
  };
}

export class UncheckedAuthParameterAnalyzer {
  public static readonly RULE_ID = 'soroban-unchecked-auth-parameter';

  public analyze(sourceCode: string): UncheckedAuthParamFinding[] {
    return analyzeUncheckedAuthParameters(sourceCode).findings;
  }

  public analyzeWithReport(sourceCode: string): UncheckedAuthParamReport {
    return analyzeUncheckedAuthParameters(sourceCode);
  }
}
