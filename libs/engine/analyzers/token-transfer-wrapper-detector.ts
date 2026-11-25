import {
  extractCallables,
  findMatchingClose,
  FunctionModel,
  lineAndColumn,
  prepareSoliditySource,
} from "./solidity-source-utils";

export type TransferWrapperReturnKind =
  | "assumes-bool-return"
  | "unchecked-boolean-return"
  | "unsafe-low-level-wrapper"
  | "decode-without-length-check";

export interface TransferWrapperReturnFinding {
  kind: TransferWrapperReturnKind;
  line: number;
  startColumn: number;
  endColumn: number;
  callSite: string;
  reason: string;
  confidence: number;
  evidence: string[];
  remediation: string;
}

export interface TransferWrapperReturnDetection {
  findings: TransferWrapperReturnFinding[];
  diagnostics: string[];
}

const HIGH_LEVEL_TRANSFER_CALL = /\.\s*(transfer|transferFrom)\s*\(/g;

const LOW_LEVEL_TRANSFER_CALL =
  /\.\s*call\s*(?:\{[^}]*\}\s*)?\(\s*(?:abi\s*\.\s*(?:encodeWithSelector|encodeWithSignature|encodeCall)\s*\(\s*(?:[\w$.]+\s*,\s*)?|bytes4\s*\([^)]*\)\s*,\s*|0xa9059cbb|0x23b872dd)/g;

const SAFE_ERC20_IMPORT_OR_USAGE =
  /\b(?:SafeERC20|safeTransfer|safeTransferFrom|SafeTransferLib)\b/;

const DECODE_CHECK =
  /\babi\s*\.\s*decode\s*\(\s*(\w+)\s*,\s*\(\s*bool\s*\)\s*\)/;

const DATA_LENGTH_CHECK =
  /\b(?:data|returndata|\w+)\s*\.\s*length\s*(?:==\s*0|>=\s*32|>\s*0)/;

export function detectTokenTransferWrapperReturns(
  input: unknown,
): TransferWrapperReturnDetection {
  const prepared = prepareSoliditySource(
    input,
    "Token transfer wrapper returns",
  );
  if (!prepared.ok) {
    return { findings: [], diagnostics: [prepared.diagnostic] };
  }

  const source = input as string;
  const { code, text } = prepared;
  const findings: TransferWrapperReturnFinding[] = [];

  const callables = extractCallables(code);

  // 1. Detect high-level typed transfer/transferFrom without SafeERC20
  let match: RegExpExecArray | null;
  const transferRegex = new RegExp(HIGH_LEVEL_TRANSFER_CALL.source, "g");
  while ((match = transferRegex.exec(code)) !== null) {
    // Check if the call is actually safeTransfer / safeTransferFrom
    const beforeCall = code.slice(Math.max(0, match.index - 5), match.index);
    if (/safe$/i.test(beforeCall)) {
      continue;
    }

    const open = code.indexOf("(", match.index);
    const close = findMatchingClose(code, open);
    if (close < 0) continue;

    const fullCall = code.slice(match.index, close + 1);
    const { line, column } = lineAndColumn(source, match.index);

    // Look at statement context
    const lineStart = code.lastIndexOf("\n", match.index) + 1;
    const lineEnd = code.indexOf(";", close);
    const statement = code
      .slice(lineStart, lineEnd >= 0 ? lineEnd : close + 1)
      .trim();

    const isDirectStatement =
      statement.startsWith("IERC20") ||
      statement.startsWith("token.") ||
      statement.startsWith("IERC20Upgradeable");
    const capturesReturn =
      /\bbool\s+\w+\s*=/.test(statement) ||
      /\brequire\s*\(\s*token\.(?:transfer|transferFrom)/.test(statement);

    if (capturesReturn) {
      findings.push({
        kind: "assumes-bool-return",
        line,
        startColumn: column,
        endColumn: column + fullCall.length,
        callSite: fullCall,
        reason:
          "Call expects a boolean return value from transfer/transferFrom: non-standard tokens returning no data (e.g. USDT) will revert upon decoding.",
        confidence: 0.9,
        evidence: [
          `Call site: '${fullCall}'`,
          "Solidity ABI decoder reverts when 0 bytes are returned for high-level calls typed as returning bool.",
        ],
        remediation:
          "Use OpenZeppelin SafeERC20.safeTransfer or SafeERC20.safeTransferFrom to handle both bool-returning and non-returning tokens.",
      });
    } else if (
      isDirectStatement &&
      !statement.includes("require") &&
      !statement.includes("if")
    ) {
      findings.push({
        kind: "unchecked-boolean-return",
        line,
        startColumn: column,
        endColumn: column + fullCall.length,
        callSite: fullCall,
        reason:
          "The return value of transfer/transferFrom is ignored: tokens returning false on failure (e.g. ZRX, BAT) will silently fail without reverting.",
        confidence: 0.85,
        evidence: [
          `Statement: '${statement}'`,
          "Return value is neither captured nor checked against boolean failure.",
        ],
        remediation:
          "Check the return value or wrap token interactions with SafeERC20 to ensure failed transfers revert.",
      });
    }
  }

  // 2. Detect flawed custom low-level transfer wrappers
  const lowLevelRegex = new RegExp(LOW_LEVEL_TRANSFER_CALL.source, "g");
  while ((match = lowLevelRegex.exec(code)) !== null) {
    const enclosingFn = callables.find(
      (c) =>
        c.bodyStart !== -1 &&
        match!.index > c.bodyStart &&
        match!.index < c.bodyEnd,
    );
    if (!enclosingFn) continue;

    const fnBody = code.slice(enclosingFn.bodyStart, enclosingFn.bodyEnd);
    const { line, column } = lineAndColumn(source, match.index);

    const hasDataLengthCheck = DATA_LENGTH_CHECK.test(fnBody);
    const hasDecode = DECODE_CHECK.test(fnBody);

    if (hasDecode && !hasDataLengthCheck) {
      findings.push({
        kind: "decode-without-length-check",
        line,
        startColumn: column,
        endColumn: column + 10,
        callSite: enclosingFn.name,
        reason: `Custom transfer wrapper '${enclosingFn.name}' decodes returndata into a boolean without verifying that return data was received, which reverts on tokens with empty return data.`,
        confidence: 0.9,
        evidence: [
          `Function '${enclosingFn.name}' executes low-level call and decodes data with abi.decode(data, (bool)).`,
          "Lacks (data.length == 0 || abi.decode(data, (bool))) guard.",
        ],
        remediation:
          "Require success && (data.length == 0 || abi.decode(data, (bool))) in low-level transfer wrappers to support both standard and non-standard tokens.",
      });
    } else if (!hasDecode && !hasDataLengthCheck) {
      findings.push({
        kind: "unsafe-low-level-wrapper",
        line,
        startColumn: column,
        endColumn: column + 10,
        callSite: enclosingFn.name,
        reason: `Custom transfer wrapper '${enclosingFn.name}' checks call success but ignores return data, treating explicit boolean false returns as successful transfers.`,
        confidence: 0.85,
        evidence: [
          `Function '${enclosingFn.name}' executes low-level call without inspecting returned bytes data.`,
        ],
        remediation:
          "Inspect return data: require(success && (data.length == 0 || abi.decode(data, (bool))), 'Transfer failed').",
      });
    }
  }

  return { findings, diagnostics: [] };
}
