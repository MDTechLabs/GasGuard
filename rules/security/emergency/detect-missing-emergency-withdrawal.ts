/**
 * Detect Missing Emergency Withdrawal Mechanisms (#354)
 *
 * Contracts that hold ETH or ERC-20 tokens without any emergency withdrawal
 * or fund-recovery mechanism risk permanently locking user funds if the
 * contract becomes paused, if access keys are lost, or if a critical bug
 * is discovered.
 *
 * This rule flags contracts that:
 *  1. Receive ETH (via `receive()`, `fallback()`, or `payable` functions) or
 *     interact with ERC-20 tokens but expose NO recovery function.
 *  2. Have a `pause()` / `emergency` / `lockdown` pattern but no corresponding
 *     withdrawal or rescue path.
 *
 * A "recovery method" is any of:
 *  - A function whose name contains `withdraw`, `rescue`, `recover`,
 *    `emergencyExit`, `drain`, or `sweep`.
 *  - A `selfdestruct` call (deprecated but still used as an escape hatch).
 *
 * Suggestions surface actionable emergency-flow patterns the author can adopt.
 */

export type EmergencyWithdrawalViolationKind =
  | 'eth-receiver-no-withdrawal'
  | 'token-handler-no-withdrawal'
  | 'pausable-no-withdrawal';

export interface EmergencyWithdrawalViolation {
  kind: EmergencyWithdrawalViolationKind;
  contractName: string;
  line: number;
  snippet: string;
  reason: string;
  suggestion: string;
}

export interface EmergencyWithdrawalResult {
  detected: boolean;
  violations: EmergencyWithdrawalViolation[];
  message: string;
  suggestion: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const PRAGMA_RE = /pragma\s+solidity\s+([^;]+);/;

function stripComments(code: string): string {
  return code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

// ─── patterns ────────────────────────────────────────────────────────────────

/** Matches `contract Name [is ...] {` — captures the contract name. */
const CONTRACT_RE = /\bcontract\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:is\s+[^{]+)?\{/g;

/**
 * Patterns that indicate a contract receives / holds value.
 * We look for each of these in the stripped source.
 */
const ETH_RECEIVER_PATTERNS: RegExp[] = [
  /\breceive\s*\(\s*\)\s*external\s+payable/,
  /\bfallback\s*\(\s*\)\s*external\s+payable/,
  /\bfunction\s+\w+\s*\([^)]*\)\s*(?:public|external)\s+payable/,
  /\bmsg\.value\b/,
];

const TOKEN_HANDLER_PATTERNS: RegExp[] = [
  /\bIERC20\b/,
  /\bsafeTransferFrom\b/,
  /\btransferFrom\b/,
  /\.transfer\s*\(/,
  /\.balanceOf\s*\(/,
];

const PAUSABLE_PATTERNS: RegExp[] = [
  /\bpause\s*\(\s*\)/,
  /\bemergency\b/i,
  /\blockdown\b/i,
  /\bwhenNotPaused\b/,
];

/** Names that constitute a recovery method. */
const RECOVERY_NAME_RE =
  /\bfunction\s+(withdraw|rescue|recover|emergencyExit|drain|sweep)\b/i;

/** `selfdestruct` is also an escape hatch. */
const SELFDESTRUCT_RE = /\bselfdestruct\b/;

// ─── reason / suggestion maps ─────────────────────────────────────────────

const REASON_MAP: Record<EmergencyWithdrawalViolationKind, string> = {
  'eth-receiver-no-withdrawal':
    'Contract receives or holds ETH but exposes no emergency withdrawal function. Funds may become permanently locked.',
  'token-handler-no-withdrawal':
    'Contract interacts with ERC-20 tokens but exposes no rescue or recovery function. Tokens may become permanently locked.',
  'pausable-no-withdrawal':
    'Contract has pause/emergency functionality but provides no corresponding fund-recovery path. Funds remain inaccessible if the contract is paused indefinitely.',
};

const SUGGESTION_MAP: Record<EmergencyWithdrawalViolationKind, string> = {
  'eth-receiver-no-withdrawal': [
    'Add an owner-only (or role-gated) `emergencyWithdraw` function:',
    '  function emergencyWithdraw(address payable to, uint256 amount) external onlyOwner {',
    '      require(to != address(0), "zero address");',
    '      (bool ok,) = to.call{value: amount}("");',
    '      require(ok, "transfer failed");',
    '  }',
    'Consider emitting an `EmergencyWithdrawal(address to, uint256 amount)` event.',
  ].join('\n'),
  'token-handler-no-withdrawal': [
    'Add an owner-only rescue function for stuck tokens:',
    '  function rescueTokens(address token, address to, uint256 amount) external onlyOwner {',
    '      IERC20(token).safeTransfer(to, amount);',
    '  }',
    'Restrict to an admin role and emit a `TokensRescued(address token, address to, uint256 amount)` event.',
  ].join('\n'),
  'pausable-no-withdrawal': [
    'Pair your pause mechanism with an emergency withdrawal path, for example:',
    '  function emergencyExit(address payable to) external onlyOwner whenPaused {',
    '      uint256 bal = address(this).balance;',
    '      (bool ok,) = to.call{value: bal}("");',
    '      require(ok, "transfer failed");',
    '  }',
    'This ensures funds are reachable even in a locked-down state.',
  ].join('\n'),
};

// ─── per-contract extraction ──────────────────────────────────────────────

/**
 * Extract the body of a contract starting at `{` offset.
 * Returns the raw (non-comment-stripped) body so line numbers remain accurate.
 */
function extractContractBody(code: string, openBraceOffset: number): string {
  let depth = 0;
  let i = openBraceOffset;
  while (i < code.length) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(openBraceOffset, i + 1);
    }
    i++;
  }
  return code.slice(openBraceOffset);
}

function hasRecoveryMethod(body: string): boolean {
  const stripped = stripComments(body);
  return RECOVERY_NAME_RE.test(stripped) || SELFDESTRUCT_RE.test(stripped);
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

// ─── main export ─────────────────────────────────────────────────────────────

export function detectMissingEmergencyWithdrawal(
  code: string,
): EmergencyWithdrawalResult {
  const violations: EmergencyWithdrawalViolation[] = [];
  const stripped = stripComments(code);

  CONTRACT_RE.lastIndex = 0;
  let contractMatch: RegExpExecArray | null;

  while ((contractMatch = CONTRACT_RE.exec(stripped)) !== null) {
    const contractName = contractMatch[1];
    const bodyStart = stripped.indexOf('{', contractMatch.index + contractMatch[0].length - 1);
    if (bodyStart === -1) continue;

    const body = extractContractBody(stripped, bodyStart);
    const contractLine = lineAt(code, contractMatch.index);
    const snippet = contractMatch[0].trim().split('\n')[0].trim();

    const hasRecovery = hasRecoveryMethod(body);
    if (hasRecovery) continue; // already protected

    const receivesEth = matchesAny(ETH_RECEIVER_PATTERNS, body);
    const handlesTokens = matchesAny(TOKEN_HANDLER_PATTERNS, body);
    const hasPause = matchesAny(PAUSABLE_PATTERNS, body);

    if (receivesEth) {
      const kind: EmergencyWithdrawalViolationKind = 'eth-receiver-no-withdrawal';
      violations.push({
        kind,
        contractName,
        line: contractLine,
        snippet,
        reason: REASON_MAP[kind],
        suggestion: SUGGESTION_MAP[kind],
      });
    } else if (handlesTokens) {
      const kind: EmergencyWithdrawalViolationKind = 'token-handler-no-withdrawal';
      violations.push({
        kind,
        contractName,
        line: contractLine,
        snippet,
        reason: REASON_MAP[kind],
        suggestion: SUGGESTION_MAP[kind],
      });
    } else if (hasPause) {
      const kind: EmergencyWithdrawalViolationKind = 'pausable-no-withdrawal';
      violations.push({
        kind,
        contractName,
        line: contractLine,
        snippet,
        reason: REASON_MAP[kind],
        suggestion: SUGGESTION_MAP[kind],
      });
    }
  }

  if (violations.length === 0) {
    return {
      detected: false,
      violations: [],
      message: 'No missing emergency withdrawal mechanisms detected.',
      suggestion: '',
    };
  }

  const summary = violations
    .map((v) => `${v.contractName} (line ${v.line}): ${v.kind}`)
    .join('; ');

  return {
    detected: true,
    violations,
    message: `${violations.length} contract(s) lack emergency withdrawal mechanisms: ${summary}.`,
    suggestion:
      'Add owner-gated or role-gated emergency withdrawal functions. ' +
      'Emit events for all fund movements. ' +
      'Consider a time-lock on large withdrawals and test the recovery path explicitly.',
  };
}
