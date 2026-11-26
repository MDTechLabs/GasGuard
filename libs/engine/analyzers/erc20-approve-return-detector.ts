import {
  expressionChainStart,
  findMatchingClose,
  lineAndColumn,
  prepareSoliditySource,
  restOfEnclosingBlock,
  splitTopLevelArguments,
  statementStart,
} from "./solidity-source-utils";

export type ApproveReturnKind =
  /** Result of a typed approve() is discarded: an explicit `false` is silently ignored. */
  | "discarded-return"
  /** Typed approve() result is required to be a bool: tokens returning no data revert. */
  | "assumes-bool-return"
  /** Low-level approve call whose success flag is never checked. */
  | "unchecked-low-level-call"
  /** Low-level approve call that checks success but ignores returndata (false treated as success). */
  | "returndata-ignored"
  /** Low-level approve call that decodes a bool without tolerating empty returndata. */
  | "decode-without-length-check"
  /** A safe-wrapper call whose implementation is not imported or defined in the source. */
  | "wrapper-unavailable";

export interface ApproveReturnFinding {
  kind: ApproveReturnKind;
  line: number;
  startColumn: number;
  endColumn: number;
  callSite: string;
  confidence: number;
  evidence: string[];
}

export interface ApproveReturnDetection {
  findings: ApproveReturnFinding[];
  diagnostics: string[];
}

const SAFE_WRAPPER_MEMBERS = /^(safeApprove|forceApprove|safeIncreaseAllowance|safeDecreaseAllowance)$/;
const SAFE_WRAPPER_CALL = /\.\s*(safeApprove|forceApprove|safeIncreaseAllowance|safeDecreaseAllowance)\s*\(/g;
const APPROVE_CALL = /\.\s*approve\s*\(/g;
const LOW_LEVEL_CALL = /\.\s*call\s*(?:\{[^}]*\}\s*)?\(/g;
const APPROVE_ENCODING =
  /approve\s*\(\s*address\s*,\s*uint256\s*\)|\.\s*approve\s*\.\s*selector|0x095ea7b3|encodeCall\s*\(\s*[\w$.]+\.approve\b/;
const NON_ERC20_RECEIVER = /^(this|super)$|nft|721|erc1155|collection/i;

function isUsedAsCondition(rest: string, variable: string): boolean {
  const name = variable.replace(/\$/g, "\\$");
  return new RegExp(
    String.raw`\b(?:require|assert|if|while)\s*\(\s*!?\s*${name}\b|\breturn\s+!?\s*${name}\b|\b${name}\s*(?:&&|\|\|)|(?:&&|\|\|)\s*!?\s*${name}\b|\bif\s*\(\s*!\s*${name}\b`,
  ).test(rest);
}

function wrapperImplementationAvailable(code: string, text: string): boolean {
  return (
    /\bimport\b[^;]*SafeERC20/.test(text) ||
    /\b(?:library|contract|abstract\s+contract)\s+SafeERC20\b/.test(code) ||
    /\bfunction\s+(?:safeApprove|forceApprove|safeIncreaseAllowance|safeDecreaseAllowance)\s*\(/.test(code)
  );
}

export function detectUncheckedApproveReturns(input: unknown): ApproveReturnDetection {
  const prepared = prepareSoliditySource(input, "ERC-20 approve return value");
  if (!prepared.ok) return { findings: [], diagnostics: [prepared.diagnostic] };

  const source = input as string;
  const { code, text } = prepared;
  const findings: ApproveReturnFinding[] = [];

  const push = (
    start: number,
    end: number,
    kind: ApproveReturnKind,
    confidence: number,
    evidence: string[],
  ) => {
    const { line, column } = lineAndColumn(source, start);
    findings.push({
      kind,
      line,
      startColumn: column,
      endColumn: column + (end - start) - 1,
      callSite: source.slice(start, end).replace(/\s+/g, " ").trim(),
      confidence,
      evidence,
    });
  };

  // Typed calls: token.approve(spender, amount) / IERC20(token).approve(...).
  let match: RegExpExecArray | null;
  const approve = new RegExp(APPROVE_CALL.source, "g");
  while ((match = approve.exec(code)) !== null) {
    const open = code.indexOf("(", match.index);
    const close = findMatchingClose(code, open);
    if (close < 0) continue;
    if (splitTopLevelArguments(code, open, close).length !== 2) continue;

    const receiverStart = expressionChainStart(code, match.index);
    const receiver = code.slice(receiverStart, match.index).trim();
    if (receiver === "" || NON_ERC20_RECEIVER.test(receiver)) continue;

    const stmtStart = statementStart(code, receiverStart);
    const prefix = code.slice(stmtStart, receiverStart).trim();
    const callSiteEnd = close + 1;
    const after = code.slice(callSiteEnd).trimStart();

    const statementLevel = prefix === "" || /^(?:else|(?:if|while|for)\s*\([^]*\))$/.test(prefix);
    if (statementLevel && /^;/.test(after)) {
      push(receiverStart, callSiteEnd, "discarded-return", 0.85, [
        `The result of ${receiver}.approve(...) is discarded as an expression statement.`,
        "A token that returns false instead of reverting leaves the allowance unchanged without any signal.",
        "If the interface declares a bool return, tokens that return no data (for example USDT) revert at ABI decoding instead.",
      ]);
      continue;
    }

    const assignment = /^(?:bool\s+)?([A-Za-z_$][\w$]*)\s*=$/.exec(prefix);
    if (assignment && /^;/.test(after)) {
      const rest = restOfEnclosingBlock(code, callSiteEnd);
      if (!isUsedAsCondition(rest, assignment[1])) {
        push(receiverStart, callSiteEnd, "discarded-return", 0.8, [
          `The bool assigned from ${receiver}.approve(...) to '${assignment[1]}' is never checked in the enclosing block.`,
        ]);
      }
      continue;
    }

    if (/(?:\b(?:require|assert|if|while)\s*\(|\breturn|!|&&|\|\|)\s*\(?\s*$/.test(prefix)) {
      push(receiverStart, callSiteEnd, "assumes-bool-return", 0.6, [
        `The approve() result of ${receiver} is consumed as a bool.`,
        "This succeeds for tokens that return true and fails closed for tokens that return false, but a token that returns no data (USDT-style) makes the typed call revert.",
      ]);
    }
  }

  // Low-level calls whose payload encodes approve(address,uint256).
  const lowLevel = new RegExp(LOW_LEVEL_CALL.source, "g");
  while ((match = lowLevel.exec(code)) !== null) {
    const argsOpen = match.index + match[0].length - 1;
    const close = findMatchingClose(code, argsOpen);
    if (close < 0) continue;
    if (!APPROVE_ENCODING.test(text.slice(argsOpen, close + 1))) continue;

    const receiverStart = expressionChainStart(code, match.index);
    const stmtStart = statementStart(code, receiverStart);
    const prefix = code.slice(stmtStart, receiverStart).trim();
    const callSiteEnd = close + 1;
    const rest = restOfEnclosingBlock(code, callSiteEnd);

    const tuple = /^\(\s*(?:bool\s+)?([A-Za-z_$][\w$]*)?\s*,\s*(?:bytes\s+memory\s+([A-Za-z_$][\w$]*)\s*)?\)\s*=$/.exec(prefix);
    if (!tuple) {
      if (prefix === "") {
        push(receiverStart, callSiteEnd, "unchecked-low-level-call", 0.9, [
          "The (bool success, bytes memory data) result of the low-level approve call is discarded entirely.",
          "A reverting token is silently ignored and no allowance is guaranteed to exist afterwards.",
        ]);
      }
      continue;
    }

    const success = tuple[1];
    const data = tuple[2];
    if (!success || !isUsedAsCondition(rest, success)) {
      push(receiverStart, callSiteEnd, "unchecked-low-level-call", 0.9, [
        "The success flag of the low-level approve call is never checked.",
      ]);
      continue;
    }
    if (!data) {
      push(receiverStart, callSiteEnd, "returndata-ignored", 0.7, [
        "Success is checked but returndata is dropped, so a token that returns false is treated as having approved.",
        "Tokens returning no data and tokens returning true are handled; explicit false is not.",
      ]);
      continue;
    }
    const decoded = new RegExp(String.raw`abi\s*\.\s*decode\s*\(\s*${data}\b`).test(rest);
    const lengthChecked = new RegExp(String.raw`\b${data}\s*\.\s*length\b`).test(rest);
    if (!decoded) {
      push(receiverStart, callSiteEnd, "returndata-ignored", 0.7, [
        `Returndata '${data}' is captured but never decoded, so a false return is treated as success.`,
      ]);
    } else if (!lengthChecked) {
      push(receiverStart, callSiteEnd, "decode-without-length-check", 0.75, [
        `Returndata '${data}' is decoded as bool without checking its length.`,
        "Tokens that return no data make abi.decode revert, and malformed short returndata reverts or is misread.",
      ]);
    }
  }

  // Established safe wrappers are not reported unless their implementation is unavailable.
  if (!wrapperImplementationAvailable(code, text)) {
    const wrapper = new RegExp(SAFE_WRAPPER_CALL.source, "g");
    while ((match = wrapper.exec(code)) !== null) {
      if (!SAFE_WRAPPER_MEMBERS.test(match[1])) continue;
      const open = code.indexOf("(", match.index);
      const close = findMatchingClose(code, open);
      if (close < 0) continue;
      const receiverStart = expressionChainStart(code, match.index);
      push(receiverStart, close + 1, "wrapper-unavailable", 0.35, [
        `${match[1]} is called but no SafeERC20 import, library, or local wrapper definition is present in the analyzed source.`,
        "The wrapper's handling of no-return and false-returning tokens cannot be verified.",
      ]);
    }
  }

  findings.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return { findings, diagnostics: [] };
}
