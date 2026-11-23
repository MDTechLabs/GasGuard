import {
  expressionChainStart,
  extractFunctions,
  findMatchingClose,
  lineAndColumn,
  prepareSoliditySource,
  splitTopLevelArguments,
  statementStart,
  usesLegacyArithmetic,
} from "./solidity-source-utils";

export type AllowanceAdjustmentKind =
  /** token.increaseAllowance/decreaseAllowance result is dropped. */
  | "unchecked-adjust-call"
  /** token.increaseAllowance/decreaseAllowance is not part of ERC-20 and may not exist. */
  | "nonstandard-adjust-method"
  /** allowance is read from a token and written back through approve with arithmetic. */
  | "read-modify-write-approve"
  /** A local decrease helper subtracts without a guard under unchecked arithmetic. */
  | "unchecked-decrease-underflow"
  /** A local decrease helper silently clamps to zero instead of reverting. */
  | "saturating-decrease";

export interface AllowanceAdjustmentFinding {
  kind: AllowanceAdjustmentKind;
  line: number;
  startColumn: number;
  endColumn: number;
  callSite: string;
  confidence: number;
  evidence: string[];
}

export interface AllowanceAdjustmentDetection {
  findings: AllowanceAdjustmentFinding[];
  diagnostics: string[];
}

const ADJUST_CALL = /\.\s*(increaseAllowance|decreaseAllowance)\s*\(/g;
const APPROVE_LIKE_CALL = /\.\s*(approve|safeApprove|forceApprove)\s*\(/g;
const ARITHMETIC = /[+\-]|\.\s*(?:add|sub)\s*\(/;
const NON_TOKEN_RECEIVER = /^(this|super)$/;

function isConsumed(prefix: string): boolean {
  return /(?:\b(?:require|assert|if|while)\s*\(|\breturn|!|&&|\|\||=)\s*\(?\s*$/.test(prefix);
}

export function detectAllowanceAdjustmentRisks(input: unknown): AllowanceAdjustmentDetection {
  const prepared = prepareSoliditySource(input, "Allowance adjustment");
  if (!prepared.ok) return { findings: [], diagnostics: [prepared.diagnostic] };

  const source = input as string;
  const { code } = prepared;
  const findings: AllowanceAdjustmentFinding[] = [];
  const functions = extractFunctions(code);

  const push = (
    start: number,
    end: number,
    kind: AllowanceAdjustmentKind,
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

  // Model: resolve each call's receiver to its declared type and check whether
  // that specific contract implements the helper. Interfaces, unresolved types,
  // and bare addresses are not trusted just because the method name exists.
  const contracts = [...code.matchAll(/\b(contract|library|interface)\s+([A-Za-z_$][\w$]*)[^{]*\{/g)].map(
    (m) => {
      const open = m.index! + m[0].length - 1;
      return { kind: m[1], name: m[2], start: open, end: findMatchingClose(code, open, "{", "}") };
    },
  );
  const implementsHelper = (typeName: string | undefined, method: string): boolean => {
    const contract = contracts.find((c) => c.name === typeName && c.kind !== "interface");
    return (
      contract !== undefined &&
      functions.some(
        (fn) =>
          fn.name === method && fn.bodyStart > contract.start && fn.bodyEnd < contract.end,
      )
    );
  };
  const declaredType = (receiver: string, offset: number): string | undefined => {
    const cast = /^([A-Za-z_$][\w$]*)\s*\(/.exec(receiver);
    if (cast) return cast[1];
    if (!/^[A-Za-z_$][\w$]*$/.test(receiver)) return undefined;
    const name = receiver.replace(/\$/g, "\\$");
    const enclosing = functions.find(
      (fn) => fn.bodyStart >= 0 && offset > fn.bodyStart && offset < fn.bodyEnd,
    );
    const param = enclosing?.params.find((p) => p.name === receiver);
    if (param) return param.type;
    return new RegExp(
      String.raw`\b([A-Z][\w$]*)\s+(?:(?:public|private|internal|immutable|constant)\s+)*${name}\s*[;=]`,
    ).exec(code)?.[1];
  };

  // 1. External adjustment calls on tokens.
  let match: RegExpExecArray | null;
  const adjust = new RegExp(ADJUST_CALL.source, "g");
  while ((match = adjust.exec(code)) !== null) {
    const open = code.indexOf("(", match.index);
    const close = findMatchingClose(code, open);
    if (close < 0 || splitTopLevelArguments(code, open, close).length !== 2) continue;

    const receiverStart = expressionChainStart(code, match.index);
    const receiver = code.slice(receiverStart, match.index).trim();
    if (receiver === "" || NON_TOKEN_RECEIVER.test(receiver)) continue;
    if (implementsHelper(declaredType(receiver, match.index), match[1])) continue;

    const prefix = code.slice(statementStart(code, receiverStart), receiverStart).trim();
    const callSiteEnd = close + 1;
    const discarded = prefix === "" && /^;/.test(code.slice(callSiteEnd).trimStart());

    if (discarded) {
      push(receiverStart, callSiteEnd, "unchecked-adjust-call", 0.8, [
        `The result of ${receiver}.${match[1]}(...) is discarded.`,
        "Tokens that return false instead of reverting, or that implement the method differently, leave the allowance unchanged without any signal.",
        `No implementation of ${match[1]} is available in the analyzed source to show that it always reverts on failure.`,
      ]);
    } else if (prefix === "" || isConsumed(prefix)) {
      push(receiverStart, callSiteEnd, "nonstandard-adjust-method", 0.5, [
        `${match[1]} is not part of the ERC-20 standard and is absent from many tokens (for example USDT) and from OpenZeppelin 5.x.`,
        `No implementation of ${match[1]} is available in the analyzed source, so the call can only be assumed to exist and behave like OpenZeppelin 4.x.`,
      ]);
    }
  }

  // 2. Read-modify-write approvals on external tokens, regardless of the enclosing function's name.
  for (const fn of functions) {
    if (fn.bodyStart < 0 || fn.bodyEnd < 0) continue;
    const body = code.slice(fn.bodyStart, fn.bodyEnd);
    const approve = new RegExp(APPROVE_LIKE_CALL.source, "g");
    while ((match = approve.exec(body)) !== null) {
      const absolute = fn.bodyStart + match.index;
      const open = code.indexOf("(", absolute);
      const close = findMatchingClose(code, open);
      if (close < 0) continue;
      const args = splitTopLevelArguments(code, open, close);
      if (args.length !== 2) continue;

      const receiverStart = expressionChainStart(code, absolute);
      const receiver = code.slice(receiverStart, absolute).trim();
      if (receiver === "" || NON_TOKEN_RECEIVER.test(receiver)) continue;

      const amount = code.slice(args[1].start, args[1].end);
      if (!ARITHMETIC.test(amount)) continue;

      if (/\.\s*allowance\s*\(/.test(amount)) {
        push(receiverStart, close + 1, "read-modify-write-approve", 0.7, [
          `The new allowance passed to ${match[1]} is computed from an allowance() read in the same expression.`,
          "The read and the write are separate token calls with no atomic adjustment: a spender can use the old allowance in between.",
        ]);
        continue;
      }
      const before = code.slice(fn.bodyStart, receiverStart);
      const variable = [...amount.matchAll(/[A-Za-z_$][\w$]*/g)]
        .map((m) => m[0])
        .find((name) =>
          new RegExp(String.raw`\b${name.replace(/\$/g, "\\$")}\s*=\s*[^;]*\.\s*allowance\s*\(`).test(before),
        );
      if (variable) {
        push(receiverStart, close + 1, "read-modify-write-approve", 0.6, [
          `'${variable}' is read from allowance() earlier in '${fn.name}' and written back through ${match[1]} with arithmetic.`,
          "The sequence is not atomic with respect to the spender, so a front-running transferFrom can spend both the old and the new allowance.",
        ]);
      }
    }
  }

  // 3. Local decrease/adjust implementations that write allowance storage.
  const legacy = usesLegacyArithmetic(code);
  for (const fn of functions) {
    if (fn.bodyStart < 0 || fn.bodyEnd < 0) continue;
    const bodyOffset = fn.bodyStart + 1;
    const body = code.slice(bodyOffset, fn.bodyEnd);
    const unchecked = /\bunchecked\s*\{/.test(body);
    const paramNames = fn.params.map((p) => p.name).filter(Boolean);

    let statementOffset = 0;
    for (const statement of body.split(";")) {
      const start = bodyOffset + statementOffset;
      statementOffset += statement.length + 1;
      if (!/allowance/i.test(statement)) continue;
      if (!/(?:=|_approve\s*\()/.test(statement)) continue;

      const prefixLength = /^(?:\s*(?:unchecked\s*)?[{}])*\s*/.exec(statement)![0].length;
      const leading = prefixLength;
      const trimmed = statement.slice(prefixLength).trim();
      const ternary = /\?[^:]*-[^:]*:\s*0\b/.test(trimmed) || /\?\s*0\s*:[^;]*-/.test(trimmed);
      if (ternary) {
        push(start + leading, start + leading + trimmed.length, "saturating-decrease", 0.6, [
          `'${fn.name}' clamps the new allowance to zero when the subtracted amount is larger instead of reverting.`,
          "ERC-20 integrations such as OpenZeppelin revert on an excessive decrease; callers relying on that revert will proceed with a zero allowance.",
        ]);
        continue;
      }

      const subtracted = paramNames.find((name) =>
        new RegExp(String.raw`-\s*${name.replace(/\$/g, "\\$")}\b`).test(trimmed),
      );
      if (!subtracted || (!legacy && !unchecked) || /\.\s*sub\s*\(/.test(trimmed)) continue;

      const guardSearch = body.slice(0, start - bodyOffset);
      const guarded = new RegExp(
        String.raw`\b(?:require|assert|if)\s*\([^;{]*\b${subtracted.replace(/\$/g, "\\$")}\b`,
      ).test(guardSearch);
      if (guarded) continue;

      push(start + leading, start + leading + trimmed.length, "unchecked-decrease-underflow", 0.8, [
        `'${fn.name}' subtracts '${subtracted}' from an allowance with no preceding comparison.`,
        legacy
          ? "The pragma selects Solidity < 0.8, where arithmetic wraps silently."
          : "The subtraction is inside an unchecked block, so it wraps silently.",
        "An excessive decrease wraps to a huge allowance instead of failing.",
      ]);
    }
  }

  findings.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return { findings, diagnostics: [] };
}
