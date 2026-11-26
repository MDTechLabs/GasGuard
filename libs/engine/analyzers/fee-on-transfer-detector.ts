import {
  expressionChainStart,
  extractFunctions,
  findMatchingClose,
  lineAndColumn,
  prepareSoliditySource,
  splitTopLevelArguments,
} from "./solidity-source-utils";

export type FeeOnTransferKind =
  /** Tokens are pulled in, then accounting is credited with the requested amount. */
  | "nominal-credit"
  /** An external withdrawal is forwarded to a recipient using the requested amount. */
  | "withdrawal-nominal-forward";

export type FeeOnTransferFlow =
  | "deposit"
  | "liquidity"
  | "staking"
  | "swap"
  | "repayment"
  | "withdrawal"
  | "transfer-in";

/**
 * How the surrounding contract treats fee-on-transfer tokens:
 * - `claimed-support`: documentation or identifiers say they are handled.
 * - `unspecified`: no statement either way, so the assumption is accidental.
 * - `explicit-unsupported`: documentation or a revert message rejects them (not reported).
 */
export type FeeOnTransferPolicy = "claimed-support" | "unspecified" | "explicit-unsupported";

export interface FeeOnTransferFinding {
  kind: FeeOnTransferKind;
  flow: FeeOnTransferFlow;
  policy: Exclude<FeeOnTransferPolicy, "explicit-unsupported">;
  line: number;
  startColumn: number;
  endColumn: number;
  callSite: string;
  creditLine: number;
  confidence: number;
  evidence: string[];
}

export interface FeeOnTransferDetection {
  findings: FeeOnTransferFinding[];
  /** Transfer-in sites that were not reported because the contract rejects such tokens explicitly. */
  suppressedByPolicy: Array<{ line: number; reason: string }>;
  diagnostics: string[];
}

const TRANSFER_IN = /\.\s*(transferFrom|safeTransferFrom)\s*\(/g;
const TRANSFER_OUT = /\.\s*(transfer|safeTransfer)\s*\(/g;
const EXTERNAL_PULL = /\.\s*(withdraw|redeem|unstake|remove\w*|exit)\s*\(/g;
const NON_FUNGIBLE_RECEIVER = /^(this|super)$|nft|721|erc1155|collection|deed/i;
const BALANCE_READ = /\.\s*balanceOf\s*\(/g;
const FEE_TERM = /fee[\s_-]*on[\s_-]*transfer|deflationary|rebas(?:ing|e)\s+token|\btaxed?\s+tokens?\b|transfer[\s_-]*tax/gi;
const NEGATION =
  /\b(?:not|no|never|unsupported|without|reject\w*|disallow\w*|incompatible|exclud\w*|forbid\w*|don'?t|doesn'?t|cannot|can'?t|unsafe|revert\w*)\b/i;
const CREDIT_CALL = /^(?:_?mint|_?issue|_?credit|_?deposit|_?stake|_?addLiquidity|_?increase\w*)$/;
const LOCAL_DECLARATION =
  /^\s*(?:uint\d*|int\d*|address|bool|bytes\d*|[A-Z][\w$]*)\s+(?:memory\s+|storage\s+|calldata\s+)?[A-Za-z_$][\w$]*\s*=/;

function classifyFlow(name: string, taintedNames: string[], statements: string): FeeOnTransferFlow {
  if (/swap|exchange|trade/i.test(name) || taintedNames.some((n) => /amountOut/i.test(n))) return "swap";
  if (/liquidity|\bpool\b|\blp\b/i.test(name)) return "liquidity";
  if (/stake|farm|bond/i.test(name)) return "staking";
  if (/repay|payback/i.test(name)) return "repayment";
  if (/withdraw|redeem|unstake|claim/i.test(name)) return "withdrawal";
  if (/deposit|mint|supply|fund|contribute/i.test(name) || /\bshares?\b/i.test(statements)) return "deposit";
  return "transfer-in";
}

/** Policy of the contract that encloses `offset`, read from its comments, identifiers and revert strings. */
function contractPolicy(source: string, code: string, offset: number): FeeOnTransferPolicy {
  const contracts = [...code.matchAll(/\b(?:contract|library)\s+[A-Za-z_$][\w$]*[^{]*\{/g)].map((m) => {
    const open = m.index! + m[0].length - 1;
    return { start: m.index!, end: findMatchingClose(code, open, "{", "}") };
  });
  const index = contracts.findIndex((c) => offset > c.start && offset < c.end);
  if (index < 0) return "unspecified";
  // Include the NatSpec/comment block between the previous contract and this one.
  const regionStart = index > 0 ? contracts[index - 1].end : 0;
  const region = source.slice(regionStart, contracts[index].end);

  let claimed = false;
  const term = new RegExp(FEE_TERM.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = term.exec(region)) !== null) {
    const window = region.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
    if (NEGATION.test(window)) return "explicit-unsupported";
    claimed = true;
  }
  return claimed ? "claimed-support" : "unspecified";
}

export function detectFeeOnTransferAccounting(input: unknown): FeeOnTransferDetection {
  const prepared = prepareSoliditySource(input, "Fee-on-transfer accounting");
  if (!prepared.ok) {
    return { findings: [], suppressedByPolicy: [], diagnostics: [prepared.diagnostic] };
  }

  const source = input as string;
  const { code } = prepared;
  const findings: FeeOnTransferFinding[] = [];
  const suppressedByPolicy: Array<{ line: number; reason: string }> = [];

  for (const fn of extractFunctions(code)) {
    if (fn.bodyStart < 0 || fn.bodyEnd < 0) continue;
    const body = code.slice(fn.bodyStart, fn.bodyEnd);

    const transferIn = new RegExp(TRANSFER_IN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = transferIn.exec(body)) !== null) {
      const absolute = fn.bodyStart + match.index;
      const open = code.indexOf("(", absolute);
      const close = findMatchingClose(code, open);
      if (close < 0) continue;
      const args = splitTopLevelArguments(code, open, close).map((a) => code.slice(a.start, a.end).trim());

      const receiverStart = expressionChainStart(code, absolute);
      const receiver = code.slice(receiverStart, absolute).trim();
      // token.transferFrom(from, to, amount) or SafeERC20.safeTransferFrom(token, from, to, amount)
      const library = /^SafeERC20$/.test(receiver) && args.length === 4;
      if (!library && (args.length !== 3 || receiver === "" || NON_FUNGIBLE_RECEIVER.test(receiver))) continue;
      const to = library ? args[2] : args[1];
      const amount = library ? args[3] : args[2];
      if (!/^(?:address\s*\(\s*this\s*\)|this)$/.test(to)) continue;

      const callEnd = close + 1;
      const before = code.slice(fn.bodyStart, receiverStart);
      const after = code.slice(callEnd, fn.bodyEnd);
      const { line, column } = lineAndColumn(source, receiverStart);
      const callSite = source.slice(receiverStart, callEnd).replace(/\s+/g, " ").trim();

      // Balance-delta accounting: the contract's token balance is read on both sides of the pull.
      const readsBefore = new RegExp(BALANCE_READ.source).test(before);
      const readsAfter = new RegExp(BALANCE_READ.source).test(after);
      if (readsBefore && readsAfter) continue;

      // Track the requested amount and anything derived from it through the rest of the function.
      const tainted = new Set(amount.match(/[A-Za-z_$][\w$]*/g) ?? []);
      tainted.delete("address");
      tainted.delete("this");
      if (tainted.size === 0) continue;
      const mentionsTainted = (text: string) => [...tainted].some((n) => new RegExp(String.raw`\b${n.replace(/\$/g, "\\$")}\b`).test(text));

      let creditLine = 0;
      let creditText = "";
      let offset = callEnd;
      for (const statement of after.split(";")) {
        const statementOffset = offset;
        offset += statement.length + 1;
        const trimmed = statement.replace(/^(?:\s*[{}])*/, "").trim();
        if (trimmed === "" || !mentionsTainted(trimmed)) continue;

        const declaration = /^\s*(?:uint\d*|int\d*)\s+([A-Za-z_$][\w$]*)\s*=/.exec(trimmed);
        if (declaration) {
          tainted.add(declaration[1]);
          continue;
        }
        const assignment = /^([^=!<>]+?)\s*(\+=|-=|=)(?!=)\s*([^]*)$/.exec(trimmed);
        const credit =
          (assignment !== null &&
            !LOCAL_DECLARATION.test(trimmed) &&
            mentionsTainted(assignment[3]) &&
            !/^require\b|^emit\b|^if\b/.test(trimmed)) ||
          [...trimmed.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g)].some(
            (call) => CREDIT_CALL.test(call[1]) && mentionsTainted(call[2]),
          );
        if (credit) {
          creditLine = lineAndColumn(source, statementOffset + (statement.length - statement.trimStart().length)).line;
          creditText = trimmed.replace(/\s+/g, " ");
          break;
        }
      }
      if (creditLine === 0) continue;

      const policy = contractPolicy(source, code, receiverStart);
      if (policy === "explicit-unsupported") {
        suppressedByPolicy.push({
          line,
          reason: "The contract documents or enforces that fee-on-transfer tokens are unsupported.",
        });
        continue;
      }

      const flow = classifyFlow(fn.name, [...tainted], after);
      findings.push({
        kind: "nominal-credit",
        flow,
        policy,
        line,
        startColumn: column,
        endColumn: column + (callEnd - receiverStart) - 1,
        callSite,
        creditLine,
        confidence: policy === "claimed-support" ? 0.85 : 0.6,
        evidence: [
          `'${fn.name}' pulls tokens with ${callSite} and later credits the requested amount (line ${creditLine}: ${creditText}).`,
          "No token balance read brackets the transfer, so the amount actually received is never measured.",
          policy === "claimed-support"
            ? "The contract states that fee-on-transfer tokens are handled, but this path credits the nominal amount."
            : "The contract does not state a fee-on-transfer policy, so the nominal-amount assumption looks accidental rather than deliberate.",
        ],
      });
    }

    // Withdrawal flows: an external pull is forwarded to the recipient using the requested amount.
    const transferOut = new RegExp(TRANSFER_OUT.source, "g");
    while ((match = transferOut.exec(body)) !== null) {
      const absolute = fn.bodyStart + match.index;
      const open = code.indexOf("(", absolute);
      const close = findMatchingClose(code, open);
      if (close < 0) continue;
      const args = splitTopLevelArguments(code, open, close).map((a) => code.slice(a.start, a.end).trim());
      const receiverStart = expressionChainStart(code, absolute);
      const receiver = code.slice(receiverStart, absolute).trim();
      if (args.length !== 2 || receiver === "" || NON_FUNGIBLE_RECEIVER.test(receiver)) continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(args[1])) continue;

      const before = code.slice(fn.bodyStart, receiverStart);
      const pull = new RegExp(EXTERNAL_PULL.source, "g");
      let pullMatch: RegExpExecArray | null;
      let pulled = false;
      while ((pullMatch = pull.exec(before)) !== null) {
        const pullOpen = before.indexOf("(", pullMatch.index);
        const pullClose = findMatchingClose(before, pullOpen);
        if (pullClose < 0) continue;
        const pullReceiver = before.slice(expressionChainStart(before, pullMatch.index), pullMatch.index).trim();
        if (pullReceiver === "" || /^(this|super)$/.test(pullReceiver)) continue;
        if (new RegExp(String.raw`\b${args[1].replace(/\$/g, "\\$")}\b`).test(before.slice(pullOpen, pullClose))) {
          pulled = true;
        }
      }
      if (!pulled || new RegExp(BALANCE_READ.source).test(before)) continue;

      const policy = contractPolicy(source, code, receiverStart);
      const { line, column } = lineAndColumn(source, receiverStart);
      if (policy === "explicit-unsupported") {
        suppressedByPolicy.push({
          line,
          reason: "The contract documents or enforces that fee-on-transfer tokens are unsupported.",
        });
        continue;
      }
      const callEnd = close + 1;
      findings.push({
        kind: "withdrawal-nominal-forward",
        flow: "withdrawal",
        policy,
        line,
        startColumn: column,
        endColumn: column + (callEnd - receiverStart) - 1,
        callSite: source.slice(receiverStart, callEnd).replace(/\s+/g, " ").trim(),
        creditLine: line,
        confidence: policy === "claimed-support" ? 0.65 : 0.45,
        evidence: [
          `'${fn.name}' withdraws '${args[1]}' from an external contract and forwards the same nominal amount to the recipient.`,
          "No balance read measures what the external contract actually returned, so a fee or shortfall is paid from other users' funds.",
        ],
      });
    }
  }

  findings.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return { findings, suppressedByPolicy, diagnostics: [] };
}
