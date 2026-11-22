/**
 * Detect reentrancy through token hooks and receiver callbacks (#1362)
 *
 * Models ERC-777-style hooks (tokensReceived, tokensToSend, send, operatorSend, transferAndCall)
 * and ERC-721 / ERC-1155 receiver callbacks (safeTransferFrom, _safeTransfer, safeMint, _safeMint,
 * safeBatchTransferFrom, onERC721Received, onERC1155Received) as external control transfers that
 * may re-enter the calling contract before state updates are finalized.
 *
 * Key safety properties analyzed:
 *  - Checks-Effects-Interactions (CEI): State variables modified after a token hook or receiver callback
 *    transfer control before state is finalized, creating a reentrancy window.
 *  - Shared state across callback-reachable entry points: Identifies companion functions that read
 *    or modify the affected state variables during callback execution (cross-function reentrancy).
 *  - Guarded designs: Detects `nonReentrant` / mutex modifiers and inline guard locks. Recognizes when
 *    both the caller and callback-reachable entry points share the guard (safe) versus when a companion
 *    function is left unguarded (cross-function reentrancy risk).
 *  - Intentionally callback-safe patterns: Early state updates (CEI compliant), view/pure entry points,
 *    and access-controlled administrative functions.
 *
 * Supported: Solidity 0.6 – 0.8.x source text, single file.
 */

import {
  Confidence,
  DetectorFinding,
  DetectorResult,
  SolidityFunction,
  Statement,
  buildResult,
  collectLocalTypes,
  collectStateTypes,
  extractFunctions,
  failedResult,
  isExternallyCallable,
  splitStatements,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "call-reentrancy-token-callbacks";

export const LIMITATIONS = [
  "Single-file analysis: callbacks and state in inherited contracts, external libraries, or interfaces outside this file are not resolved.",
  "Token interfaces and receivers are identified by standard function signatures (e.g. safeTransferFrom, _safeMint, tokensReceived, transferAndCall); non-standard or obfuscated hook names are not tracked.",
  "Dynamic call dispatch or delegatecall indirection through external proxies is not followed.",
  "Access control is judged from recognized modifiers (only*, auth*, requiresAuth, checkRole); custom authorization logic inside function bodies is not fully evaluated.",
];

const SUGGESTION =
  "Apply the Checks-Effects-Interactions (CEI) pattern by updating all internal state before invoking token callbacks (safeTransferFrom, _safeMint, send). Add `nonReentrant` guards across all functions that read or write shared state.";

export interface CallbackSite {
  functionName: string;
  line: number;
  statementIndex: number;
  callText: string;
  hookType:
    | "erc721-receiver"
    | "erc1155-receiver"
    | "erc777-hook"
    | "erc1363-callback";
  method: string;
}

export interface StateWrite {
  variable: string;
  line: number;
  statementIndex: number;
  expression: string;
}

export interface ReachableEntryPoint {
  functionName: string;
  line: number;
  visibility: string;
  isGuarded: boolean;
  sharesState: string[];
  accessRestricted: boolean;
  mutatesSharedState: boolean;
}

const CALLBACK_PATTERNS: Array<{
  pattern: RegExp;
  hookType:
    | "erc721-receiver"
    | "erc1155-receiver"
    | "erc777-hook"
    | "erc1363-callback";
}> = [
  // ERC-721 receiver callbacks
  { pattern: /\b(_?safeTransferFrom)\s*\(/, hookType: "erc721-receiver" },
  { pattern: /\b(_?safeTransfer)\s*\(/, hookType: "erc721-receiver" },
  { pattern: /\b(_?safeMint)\s*\(/, hookType: "erc721-receiver" },
  { pattern: /\b(onERC721Received)\s*\(/, hookType: "erc721-receiver" },

  // ERC-1155 receiver callbacks
  { pattern: /\b(_?safeBatchTransferFrom)\s*\(/, hookType: "erc1155-receiver" },
  { pattern: /\b(_?safeBatchTransfer)\s*\(/, hookType: "erc1155-receiver" },
  { pattern: /\b(_?safeBatchMint)\s*\(/, hookType: "erc1155-receiver" },
  { pattern: /\b(onERC1155Received)\s*\(/, hookType: "erc1155-receiver" },
  { pattern: /\b(onERC1155BatchReceived)\s*\(/, hookType: "erc1155-receiver" },

  // ERC-777 hooks
  { pattern: /\b(operatorSend)\s*\(/, hookType: "erc777-hook" },
  { pattern: /\b(operatorBurn)\s*\(/, hookType: "erc777-hook" },
  { pattern: /\b(tokensToSend)\s*\(/, hookType: "erc777-hook" },
  { pattern: /\b(tokensReceived)\s*\(/, hookType: "erc777-hook" },
  // 3-parameter send(to, amount, data) typical of ERC-777
  { pattern: /\b\w+\.(send)\s*\([^,]+,[^,]+,[^)]+\)/, hookType: "erc777-hook" },

  // ERC-1363 callbacks
  { pattern: /\b(transferAndCall)\s*\(/, hookType: "erc1363-callback" },
  { pattern: /\b(transferFromAndCall)\s*\(/, hookType: "erc1363-callback" },
  { pattern: /\b(approveAndCall)\s*\(/, hookType: "erc1363-callback" },
];

const GUARD_RE =
  /\b(?:nonReentrant|noReentrancy|reentrancyGuard|lock|locked|mutex)\b/i;
const ACCESS_RE =
  /\b(?:onlyOwner|onlyRole|onlyAdmin|authorized|requiresAuth|auth|onlyToken|onlyMinter)\b/i;

function hasReentrancyGuard(
  fn: SolidityFunction,
  statements: Statement[],
): boolean {
  if (GUARD_RE.test(fn.header)) return true;
  // Inline mutex pattern: require(!locked) or require(_status != _ENTERED)
  const hasLockCheck = statements.some(
    (s) =>
      s.kind === "stmt" &&
      /\brequire\s*\(\s*!_?(?:locked|reentrancyLock|entered)\b|\brequire\s*\(\s*_?status\s*!=\s*_?(?:ENTERED|1)\b/.test(
        s.text,
      ),
  );
  const hasLockSet = statements.some(
    (s) =>
      s.kind === "stmt" &&
      /\b_?(?:locked|reentrancyLock|entered)\s*=\s*true\b|\b_?status\s*=\s*_?(?:ENTERED|2)\b/.test(
        s.text,
      ),
  );
  return hasLockCheck && hasLockSet;
}

function hasAccessRestriction(fn: SolidityFunction): boolean {
  return ACCESS_RE.test(fn.header);
}

function findCallbackSites(
  fn: SolidityFunction,
  statements: Statement[],
): CallbackSite[] {
  const sites: CallbackSite[] = [];
  statements.forEach((stmt, idx) => {
    if (stmt.kind !== "stmt") return;
    for (const { pattern, hookType } of CALLBACK_PATTERNS) {
      const match = pattern.exec(stmt.text);
      if (match) {
        sites.push({
          functionName: fn.name,
          line: stmt.line,
          statementIndex: idx,
          callText: stmt.text.trim(),
          hookType,
          method: match[1],
        });
        break; // one match per statement
      }
    }
  });
  return sites;
}

function extractStateWrites(
  statements: Statement[],
  stateVars: Map<string, string>,
  localVars: Map<string, string>,
): StateWrite[] {
  const writes: StateWrite[] = [];

  statements.forEach((stmt, idx) => {
    if (stmt.kind !== "stmt") return;
    const text = stmt.text.trim();

    // Ignore event emissions or require/revert
    if (/^(?:emit|require|assert|revert)\b/.test(text)) return;

    // Check for delete statement: delete varName or delete varName[key]
    const deleteMatch = /^delete\s+([A-Za-z_$][\w$]*)/.exec(text);
    if (deleteMatch) {
      const varName = deleteMatch[1];
      if (stateVars.has(varName) && !localVars.has(varName)) {
        writes.push({
          variable: varName,
          line: stmt.line,
          statementIndex: idx,
          expression: text,
        });
        return;
      }
    }

    // Check for increment / decrement: varName++, varName--, ++varName, --varName, varName[k]++, etc.
    const incDecMatch =
      /^(?:\+\+|--)\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)(?:\[[^\]]*\])*(?:\+\+|--)/.exec(
        text,
      );
    if (incDecMatch) {
      const varName = incDecMatch[1] || incDecMatch[2];
      if (varName && stateVars.has(varName) && !localVars.has(varName)) {
        writes.push({
          variable: varName,
          line: stmt.line,
          statementIndex: idx,
          expression: text,
        });
        return;
      }
    }

    // Check for assignments: varName = ..., varName += ..., varName[k] = ..., varName[k].prop = ...
    const assignMatch =
      /^([A-Za-z_$][\w$]*)(?:\[[^\]]*\])*(?:\.[A-Za-z_$][\w$]*)*\s*([-+*/%|&^]|<<|>>)?=(?!=)\s*([\s\S]+)$/.exec(
        text,
      );
    if (assignMatch) {
      const varName = assignMatch[1];
      // Must be a state variable and not shadowed by a local or parameter
      if (stateVars.has(varName) && !localVars.has(varName)) {
        writes.push({
          variable: varName,
          line: stmt.line,
          statementIndex: idx,
          expression: text,
        });
        return;
      }
    }

    // Check for array operations: varName.push(...), varName.pop()
    const arrayOpMatch = /^([A-Za-z_$][\w$]*)\.(?:push|pop)\s*\(/.exec(text);
    if (arrayOpMatch) {
      const varName = arrayOpMatch[1];
      if (stateVars.has(varName) && !localVars.has(varName)) {
        writes.push({
          variable: varName,
          line: stmt.line,
          statementIndex: idx,
          expression: text,
        });
        return;
      }
    }
  });

  return writes;
}

function findSharedStateEntryPoints(
  callerFn: SolidityFunction,
  callerGuarded: boolean,
  allFns: SolidityFunction[],
  modifiedStateVars: Set<string>,
  stateVars: Map<string, string>,
  cleanSource: string,
): ReachableEntryPoint[] {
  const reachable: ReachableEntryPoint[] = [];

  for (const fn of allFns) {
    if (fn.kind !== "function") continue;
    if (!isExternallyCallable(fn)) continue;

    const fnStatements = splitStatements(fn, cleanSource);
    const fnLocals = collectLocalTypes(fn, fnStatements);
    const fnGuarded = hasReentrancyGuard(fn, fnStatements);
    const fnAccess = hasAccessRestriction(fn);

    // Collect words mentioned in the function body that match the modified state variables
    const bodyWords = new Set(wordsIn(fn.body));
    const sharedVars: string[] = [];
    let mutatesShared = false;

    const fnWrites = extractStateWrites(fnStatements, stateVars, fnLocals);
    const fnWriteVars = new Set(fnWrites.map((w) => w.variable));

    for (const v of modifiedStateVars) {
      if (bodyWords.has(v) && !fnLocals.has(v)) {
        sharedVars.push(v);
        if (fnWriteVars.has(v)) mutatesShared = true;
      }
    }

    if (sharedVars.length > 0) {
      reachable.push({
        functionName: fn.name,
        line: fn.startLine,
        visibility: fn.visibility,
        isGuarded: fnGuarded,
        sharesState: sharedVars,
        accessRestricted: fnAccess,
        mutatesSharedState: mutatesShared,
      });
    }
  }

  return reachable;
}

export function detectReentrancyTokenCallbacks(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok)
    return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);

  const findings: DetectorFinding[] = [];
  const stateVars = collectStateTypes(v.clean);
  const fns = extractFunctions(v.clean);

  for (const fn of fns) {
    if (
      fn.kind !== "function" &&
      fn.kind !== "receive" &&
      fn.kind !== "fallback"
    )
      continue;

    const statements = splitStatements(fn, v.clean);
    const localVars = collectLocalTypes(fn, statements);
    const callerGuarded = hasReentrancyGuard(fn, statements);

    const callbackSites = findCallbackSites(fn, statements);
    if (callbackSites.length === 0) continue;

    const allWrites = extractStateWrites(statements, stateVars, localVars);

    for (const site of callbackSites) {
      // Find state writes that occur strictly after the callback statement
      const postWrites = allWrites.filter(
        (w) => w.statementIndex > site.statementIndex,
      );

      if (postWrites.length === 0) {
        // Intentionally safe CEI design: all effects applied before the callback interaction!
        continue;
      }

      const affectedVars = new Set(postWrites.map((w) => w.variable));
      const affectedList = Array.from(affectedVars);

      // Analyze reachable entry points that share this state
      const entryPoints = findSharedStateEntryPoints(
        fn,
        callerGuarded,
        fns,
        affectedVars,
        stateVars,
        v.clean,
      );

      // Check whether single-function and cross-function reentrancy are guarded
      const selfReentrantPossible = !callerGuarded && isExternallyCallable(fn);

      // Companion functions: external/public, not access-restricted, sharing state
      const unguardedCompanions = entryPoints.filter(
        (ep) =>
          ep.functionName !== fn.name && !ep.isGuarded && !ep.accessRestricted,
      );

      // If caller is guarded and all companion entry points sharing state are also guarded (or restricted),
      // the reentrancy lock effectively prevents callback execution into those entry points.
      if (callerGuarded && unguardedCompanions.length === 0) {
        // Fully guarded design!
        continue;
      }

      // If caller is unguarded OR there are unguarded companion entry points, reentrancy is viable.
      const isCritical =
        selfReentrantPossible &&
        postWrites.some((w) =>
          /balance|amount|share|supply|token|debt|collateral|credit|reserve|deposit|withdraw|claim/i.test(
            w.variable,
          ),
        );

      const severity = isCritical ? "critical" : "high";
      const confidence: Confidence = "high";

      const evidence: string[] = [
        `Callback trigger at line ${site.line}: '${site.callText}' (${site.hookType} via ${site.method})`,
        `State written after callback: ${postWrites.map((w) => `'${w.variable}' at line ${w.line} (${w.expression})`).join("; ")}`,
        `Caller '${fn.name}' reentrancy guard: ${callerGuarded ? "present" : "missing"}`,
      ];

      if (selfReentrantPossible) {
        evidence.push(
          `Self-reentrancy path: '${fn.name}' can be re-entered via callback before state variables [${affectedList.join(", ")}] are updated`,
        );
      }

      if (unguardedCompanions.length > 0) {
        evidence.push(
          `Cross-function reentrancy paths into unguarded entry points: ${unguardedCompanions
            .map(
              (c) =>
                `'${c.functionName}' (shares [${c.sharesState.join(", ")}])`,
            )
            .join(", ")}`,
        );
      }

      const callChainEvidence = [
        `Call-chain: ${fn.name}() -> ${site.method}() -> recipient callback -> [${[
          ...(selfReentrantPossible ? [`${fn.name}()`] : []),
          ...unguardedCompanions.map((c) => `${c.functionName}()`),
        ].join(", ")}] accessing stale state [${affectedList.join(", ")}]`,
      ];

      evidence.push(...callChainEvidence);

      const title = selfReentrantPossible
        ? `Reentrancy via ${site.hookType} before state update in ${fn.name}()`
        : `Cross-function reentrancy via ${site.hookType} in ${fn.name}()`;

      const message =
        `${fn.name}() invokes external token callback '${site.method}' at line ${site.line} before updating state variable(s) [${affectedList.join(", ")}]. ` +
        (selfReentrantPossible
          ? `Lacks a reentrancy guard on '${fn.name}', allowing reentrant callback execution to exploit stale state.`
          : `While '${fn.name}' has a reentrancy guard, companion entry point(s) [${unguardedCompanions.map((c) => c.functionName).join(", ")}] lack guards and share the same state, enabling cross-function reentrancy.`);

      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence,
        title,
        message,
        line: site.line,
        endLine: postWrites[postWrites.length - 1].line,
        functionName: fn.name,
        evidence,
        rationale:
          "Token hooks (ERC-777) and receiver callbacks (ERC-721/ERC-1155) transfer control to arbitrary external contracts. Modifying contract state after invoking a callback violates Checks-Effects-Interactions and allows reentrant callers to operate on inconsistent state.",
        remediation: `Update state variable(s) [${affectedList.join(", ")}] before calling '${site.method}', or protect both '${fn.name}' and all companion functions with 'nonReentrant'.`,
      });
    }
  }

  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
