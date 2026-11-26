import {
  extractCallables,
  expressionChainStart,
  findMatchingClose,
  lineAndColumn,
  prepareSoliditySource,
  splitTopLevelArguments,
} from "./solidity-source-utils";

export type Erc721CallbackIssueKind =
  | "post-transfer-state-update"
  | "unauthenticated-stateful-receiver";

export interface Erc721CallbackFinding {
  kind: Erc721CallbackIssueKind;
  severity: "low" | "medium" | "high";
  functionName: string;
  line: number;
  startColumn: number;
  endColumn: number;
  evidence: string[];
  confidence: number;
  affectedState?: string;
}

export interface Erc721CallbackDetection {
  findings: Erc721CallbackFinding[];
  diagnostics: string[];
}

interface ContractRange {
  name: string;
  start: number;
  end: number;
  header: string;
}

interface StateVariable {
  name: string;
  type: string;
}

const STATE_DECLARATION =
  /\b(mapping\s*\([^;]*\)|address(?:\s+payable)?|bool|u?int\d*|bytes\d*|[A-Z][\w$]*(?:\s*\[\s*\])?)\s+(?:(?:public|private|internal|constant|immutable|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:=[^;]*)?;/g;
const MUTATING_CALL =
  /\b(?:_?safeMint|_?mint|_?burn|_?transfer|safeTransferFrom|transferFrom|setApprovalForAll|withdraw|claim|execute|grantRole)\s*\(/i;
const REENTRANCY_GUARD = /\b(?:nonReentrant|noReentrancy|reentrancyGuard|lock)\b/i;
const NFT_NAME = /(?:nft|erc721|collection|nonfungible)/i;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_CALLABLES = 2500;
const MAX_CONTRACTS = 500;

function contractsIn(code: string): ContractRange[] {
  return [...code.matchAll(/\b(?:abstract\s+)?contract\s+([A-Za-z_$][\w$]*)[^{]*\{/g)].map((match) => {
    const open = match.index! + match[0].length - 1;
    return {
      name: match[1],
      start: match.index!,
      end: findMatchingClose(code, open, "{", "}"),
      header: match[0].slice(0, -1),
    };
  });
}

function enclosingContract(contracts: ContractRange[], offset: number): ContractRange | undefined {
  return contracts.find((contract) => offset > contract.start && offset < contract.end);
}

function stateVariables(
  code: string,
  contract: ContractRange,
  callables: ReturnType<typeof extractCallables>,
): StateVariable[] {
  const chars = code.slice(contract.start, contract.end).split("");
  for (const callable of callables) {
    if (callable.start < contract.start || callable.start >= contract.end) continue;
    const end = callable.bodyEnd >= 0
      ? callable.bodyEnd + 1
      : Math.max(callable.start, code.indexOf(";", callable.start)) + 1;
    for (let i = callable.start; i < end && i < contract.end; i++) {
      if (chars[i - contract.start] !== "\n") chars[i - contract.start] = " ";
    }
  }
  const body = chars.join("");
  const variables: StateVariable[] = [];
  STATE_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STATE_DECLARATION.exec(body)) !== null) {
    variables.push({ type: match[1], name: match[2] });
  }
  return variables;
}

function localNames(body: string, params: Array<{ name: string; type: string }>): Set<string> {
  const names = new Set(params.map((param) => param.name).filter(Boolean));
  const declaration =
    /\b(?:address(?:\s+payable)?|bool|u?int\d*|bytes\d*|[A-Z][\w$]*(?:\s*\[\s*\])?)\s+(?:(?:memory|storage|calldata)\s+)?([A-Za-z_$][\w$]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(body)) !== null) names.add(match[1]);
  return names;
}

function typesInFunction(
  body: string,
  state: StateVariable[],
  params: Array<{ name: string; type: string }>,
): Map<string, string> {
  const types = new Map(state.map((variable) => [variable.name, variable.type]));
  for (const param of params) {
    if (param.name) types.set(param.name, param.type);
  }
  const declaration =
    /\b([A-Z][\w$]*)\s+(?:(?:memory|storage|calldata)\s+)?([A-Za-z_$][\w$]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(body)) !== null) types.set(match[2], match[1]);
  return types;
}

function stateWrite(
  text: string,
  variables: StateVariable[],
  locals: Set<string>,
): { name: string; index: number; end: number } | undefined {
  for (const variable of variables) {
    if (locals.has(variable.name)) continue;
    const pattern = new RegExp(
      String.raw`\b${variable.name.replace(/[$]/g, "\\$")}\b(?:\s*\[[^\]]*\])*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?:\+\+|--|(?:\+=|-=|\*=|/=|=(?!=)))`,
    );
    const match = pattern.exec(text);
    if (match) return { name: variable.name, index: match.index, end: match.index + match[0].length };
  }
  return undefined;
}

function isErc721Expression(expression: string, types: Map<string, string>): boolean {
  if (/IERC721|ERC721A?/i.test(expression) || NFT_NAME.test(expression)) return true;
  const identifiers = expression.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return identifiers.some((name) => {
    const type = types.get(name) ?? "";
    return /IERC721|ERC721A?/i.test(type);
  });
}

function trustedSenderCheck(
  header: string,
  body: string,
  nftNames: string[],
): boolean {
  if (/\bonly(?:Trusted|Authorized|Allowed|Whitelisted)?(?:NFT|ERC721|Collection)\w*\b/i.test(header)) {
    return true;
  }
  if (
    /\b(?:trusted|allowed|authorized|whitelisted)\w*\s*\[\s*msg\.sender\s*\]/i.test(body) ||
    /\b(?:isTrusted|isAllowed|isAuthorized|isWhitelisted|isKnown)\w*\s*\(\s*msg\.sender\s*\)/i.test(body)
  ) {
    return true;
  }
  if (nftNames.length === 0) return false;
  const names = nftNames.map((name) => name.replace(/[$]/g, "\\$")).join("|");
  return new RegExp(
    String.raw`(?:msg\.sender\s*==\s*(?:address\s*\(\s*)?(?:${names})\b|(?:address\s*\(\s*)?(?:${names})\s*\)?\s*==\s*msg\.sender)`,
    "i",
  ).test(body);
}

function isErc721Receiver(fn: ReturnType<typeof extractCallables>[number]): boolean {
  return (
    fn.name === "onERC721Received" &&
    fn.params.length === 4 &&
    /^address$/i.test(fn.params[0].type) &&
    /^address$/i.test(fn.params[1].type) &&
    /^u?int(?:256)?$/i.test(fn.params[2].type) &&
    /^bytes$/i.test(fn.params[3].type)
  );
}

function findSafeTransferCalls(
  code: string,
  fn: ReturnType<typeof extractCallables>[number],
  contract: ContractRange,
  types: Map<string, string>,
): Array<{ start: number; end: number }> {
  const bodyStart = fn.bodyStart + 1;
  const body = code.slice(bodyStart, fn.bodyEnd);
  const matches: Array<{ start: number; end: number }> = [];
  const callPattern = /(?:\.|\b)(safeTransferFrom|_safeTransfer)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(body)) !== null) {
    const absolute = bodyStart + match.index;
    const method = match[1];
    const open = code.indexOf("(", absolute + match[0].lastIndexOf(method) + method.length);
    const close = findMatchingClose(code, open);
    if (close < 0 || close > fn.bodyEnd) continue;
    const args = splitTopLevelArguments(code, open, close).map((part) =>
      code.slice(part.start, part.end).trim(),
    );
    const receiverStart = expressionChainStart(code, absolute);
    const receiver = code.slice(receiverStart, absolute).trim().replace(/\.$/, "");
    let tokenExpression = receiver;
    if (/^SafeERC721(?:Upgradeable)?$/i.test(receiver)) tokenExpression = args[0] ?? "";
    const internalErc721Transfer =
      method === "_safeTransfer" &&
      receiver === "" &&
      /\b(?:ERC721|ERC721A|ERC721Upgradeable)\b/i.test(contract.header);
    if (!internalErc721Transfer && !isErc721Expression(tokenExpression, types)) continue;
    matches.push({ start: absolute, end: close + 1 });
    callPattern.lastIndex = close + 1 - bodyStart;
  }
  return matches;
}

export function detectUnsafeErc721SafeTransferCallbacks(input: unknown): Erc721CallbackDetection {
  if (typeof input === "string" && input.includes("\0")) {
    return { findings: [], diagnostics: ["Binary NUL byte found; ERC-721 callback analysis was skipped."] };
  }
  if (typeof input === "string") {
    const sourceBytes = Buffer.byteLength(input, "utf8");
    if (sourceBytes > MAX_SOURCE_BYTES) {
      return {
        findings: [],
        diagnostics: [
          `Source size ${sourceBytes} bytes exceeds the ERC-721 callback analyzer limit of ${MAX_SOURCE_BYTES} bytes.`,
        ],
      };
    }
  }
  const prepared = prepareSoliditySource(input, "ERC-721 safe-transfer callback");
  if (!prepared.ok) return { findings: [], diagnostics: [prepared.diagnostic] };

  const source = input as string;
  const { code } = prepared;
  const callables = extractCallables(code);
  const contracts = contractsIn(code);
  if (callables.length > MAX_CALLABLES || contracts.length > MAX_CONTRACTS) {
    return {
      findings: [],
      diagnostics: [
        `ERC-721 callback analysis skipped: source exceeds the limit of ${MAX_CALLABLES} callables or ${MAX_CONTRACTS} contracts.`,
      ],
    };
  }

  const findings: Erc721CallbackFinding[] = [];
  const seen = new Set<string>();
  const stateByContract = new Map<number, StateVariable[]>();

  for (const fn of callables) {
    if (fn.kind !== "function" || fn.bodyStart < 0 || fn.bodyEnd < 0) continue;
    const contract = enclosingContract(contracts, fn.start);
    if (!contract) continue;
    let state = stateByContract.get(contract.start);
    if (!state) {
      state = stateVariables(code, contract, callables);
      stateByContract.set(contract.start, state);
    }
    const bodyStart = fn.bodyStart + 1;
    const body = code.slice(bodyStart, fn.bodyEnd);
    const locals = localNames(body, fn.params);
    const types = typesInFunction(body, state, fn.params);

    if (isErc721Receiver(fn) && /\b(?:external|public)\b/.test(fn.header)) {
      const effect = stateWrite(body, state, locals) ??
        (MUTATING_CALL.exec(body)
          ? {
              name: MUTATING_CALL.exec(body)![0].trim(),
              index: MUTATING_CALL.exec(body)!.index!,
              end: MUTATING_CALL.exec(body)!.index! + MUTATING_CALL.exec(body)![0].length,
            }
          : undefined);
      if (effect) {
        const nftNames = state
          .filter((variable) => /IERC721|ERC721A?/i.test(variable.type) || NFT_NAME.test(variable.name))
          .map((variable) => variable.name);
        if (!trustedSenderCheck(fn.header, body, nftNames)) {
          const offset = bodyStart + effect.index;
          const position = lineAndColumn(source, offset);
          const dangerous = /(?:_?mint|_?burn|transfer|withdraw|claim|execute|call|delegatecall)/i.test(effect.name);
          const key = `receiver:${contract.name}:${fn.start}`;
          if (!seen.has(key)) {
            seen.add(key);
            findings.push({
              kind: "unauthenticated-stateful-receiver",
              severity: dangerous ? "high" : "medium",
              functionName: fn.name,
              line: position.line,
              startColumn: position.column,
              endColumn: position.column + Math.max(1, effect.end - effect.index) - 1,
              confidence: dangerous ? 0.9 : 0.8,
              affectedState: state.some((variable) => variable.name === effect.name) ? effect.name : undefined,
              evidence: [
                `The externally callable ${fn.name} callback performs '${effect.name}' without checking that msg.sender is an authorized ERC-721 collection.`,
                "Any contract can call onERC721Received directly; safeTransferFrom does not authenticate the callback caller.",
              ],
            });
          }
        }
      }
    }

    if (REENTRANCY_GUARD.test(fn.header)) continue;
    const stateNames = state.filter((variable) => !locals.has(variable.name));
    for (const transfer of findSafeTransferCalls(code, fn, contract, types)) {
      const relativeEnd = transfer.end - bodyStart;
      const after = body.slice(relativeEnd);
      const write = stateWrite(after, stateNames, locals);
      if (!write) continue;
      const offset = transfer.start;
      const position = lineAndColumn(source, offset);
      const key = `transfer:${fn.start}:${offset}:${write.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        kind: "post-transfer-state-update",
        severity: "medium",
        functionName: fn.name,
        line: position.line,
        startColumn: position.column,
        endColumn: position.column + (transfer.end - transfer.start) - 1,
        confidence: 0.85,
        affectedState: write.name,
        evidence: [
          `ERC-721 safe transfer completes before state variable '${write.name}' is updated in '${fn.name}'.`,
          "The recipient's onERC721Received callback runs during the transfer and may reenter before this state change.",
        ],
      });
    }
  }

  findings.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return { findings, diagnostics: [] };
}
