import { Severity } from "../core/analyzer-interface";

export const SIGNATURE_SECURITY_RULES = {
  CACHED_DOMAIN_SEPARATOR: "sol-019",
  INCOMPLETE_STRUCT_HASH: "sol-020",
  WEAK_MESSAGE_SIGNING: "sol-021",
  ERC1271_COMPATIBILITY: "sol-022",
} as const;

export type ExpectedSignerType = "eoa" | "contract";

export interface SignatureSecurityFinding {
  ruleId: string;
  message: string;
  severity: Severity;
  startLine: number;
  endLine: number;
  suggestedFix: string;
  confidence: "medium" | "high";
  evidence: string[];
  issueType?: "compatibility-gap";
}

export interface SignatureSecurityResult {
  findings: SignatureSecurityFinding[];
  diagnostic?: string;
}

interface FunctionBody {
  name: string;
  start: number;
  bodyStart: number;
  bodyEnd: number;
  text: string;
}

interface TypeHash {
  identifier: string;
  fields: Array<{ name: string; type: string }>;
}

const MAX_SOURCE_BYTES = 1024 * 1024;
const DOMAIN_RULE = SIGNATURE_SECURITY_RULES.CACHED_DOMAIN_SEPARATOR;
const HASH_RULE = SIGNATURE_SECURITY_RULES.INCOMPLETE_STRUCT_HASH;
const PERSONAL_SIGN_RULE = SIGNATURE_SECURITY_RULES.WEAK_MESSAGE_SIGNING;
const ERC1271_RULE = SIGNATURE_SECURITY_RULES.ERC1271_COMPATIBILITY;

export function analyzeSignatureSecurity(
  source: string,
  expectedSignerTypes: ExpectedSignerType[],
): SignatureSecurityResult {
  if (source.includes("\0")) {
    return { findings: [], diagnostic: "Binary NUL byte found; signature analysis was skipped." };
  }
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes > MAX_SOURCE_BYTES) {
    return {
      findings: [],
      diagnostic: `Source size ${sourceBytes} bytes exceeds the signature analyzer limit of ${MAX_SOURCE_BYTES} bytes.`,
    };
  }

  const uncommented = maskComments(source);
  const versionError = unsupportedPragma(uncommented);
  if (versionError) return { findings: [], diagnostic: versionError };

  const structural = maskStrings(uncommented);
  if (structural === undefined) {
    return {
      findings: [],
      diagnostic: "Malformed Solidity source: unterminated string literal; signature analysis was skipped.",
    };
  }
  const delimiterError = validateDelimiters(structural);
  if (delimiterError) return { findings: [], diagnostic: delimiterError };

  const functions = findFunctions(structural);
  const findings = [
    ...findCachedDomainIssues(uncommented, structural, functions),
    ...findStructHashIssues(uncommented, structural),
    ...findWeakSigningIssues(uncommented, structural, functions),
    ...(expectedSignerTypes.includes("contract")
      ? findErc1271Issues(uncommented, functions)
      : []),
  ];

  return { findings };
}

function unsupportedPragma(source: string): string | undefined {
  const pragma = source.match(/\bpragma\s+solidity\s+([^;]+);/);
  if (!pragma) {
    return /\bpragma\s+solidity\b/.test(source)
      ? "Malformed Solidity pragma; expected a Solidity version followed by a semicolon."
      : undefined;
  }
  const firstVersion = pragma[1].match(/\b0\.(\d+)\.\d+\b/);
  if (!firstVersion) {
    return "Could not determine Solidity version from pragma; signature analysis supports Solidity 0.5.x through 0.8.x.";
  }
  const minor = Number(firstVersion[1]);
  if (!Number.isInteger(minor) || minor < 5 || minor > 8) {
    return `Unsupported Solidity pragma '${pragma[1].trim()}'; signature analysis supports Solidity 0.5.x through 0.8.x.`;
  }
  return undefined;
}

function maskComments(source: string): string {
  const chars = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" = "code";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        chars[i] = chars[i + 1] = " ";
        i++;
        state = "line";
      } else if (char === "/" && next === "*") {
        chars[i] = chars[i + 1] = " ";
        i++;
        state = "block";
      } else if (char === "'") {
        state = "single";
      } else if (char === '"') {
        state = "double";
      }
    } else if (state === "line") {
      if (char === "\n") state = "code";
      else chars[i] = " ";
    } else if (state === "block") {
      if (char === "*" && next === "/") {
        chars[i] = chars[i + 1] = " ";
        i++;
        state = "code";
      } else if (char !== "\n") {
        chars[i] = " ";
      }
    } else if ((state === "single" && char === "'") || (state === "double" && char === '"')) {
      state = "code";
    } else if (char === "\\") {
      i++;
    }
  }
  return chars.join("");
}

function maskStrings(source: string): string | undefined {
  const chars = source.split("");
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (!quote) {
      if (char === "'" || char === '"') {
        quote = char;
        chars[i] = " ";
      }
    } else if (char === "\\") {
      chars[i] = " ";
      if (i + 1 < source.length && source[i + 1] !== "\n") chars[++i] = " ";
    } else {
      if (char !== "\n") chars[i] = " ";
      if (char === quote) quote = undefined;
    }
  }
  if (quote) return undefined;
  return chars.join("");
}

function validateDelimiters(source: string): string | undefined {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: Array<{ char: string; index: number }> = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "(" || char === "[" || char === "{") {
      stack.push({ char, index: i });
    } else if (char === ")" || char === "]" || char === "}") {
      const open = stack.pop();
      if (!open || open.char !== pairs[char]) {
        return `Malformed Solidity source: unmatched '${char}' at line ${lineAt(source, i)}.`;
      }
    }
  }
  const unclosed = stack.pop();
  return unclosed
    ? `Malformed Solidity source: unclosed '${unclosed.char}' at line ${lineAt(source, unclosed.index)}.`
    : undefined;
}

function findFunctions(source: string): FunctionBody[] {
  const functions: FunctionBody[] = [];
  const declaration = /\b(function\s+([A-Za-z_$][\w$]*)|constructor|fallback|receive)\b/g;
  for (let match = declaration.exec(source); match; match = declaration.exec(source)) {
    const headerStart = match.index;
    let open = source.indexOf("{", declaration.lastIndex);
    const semicolon = source.indexOf(";", declaration.lastIndex);
    if (open < 0 || (semicolon >= 0 && semicolon < open)) continue;
    const bodyEnd = matchingBrace(source, open);
    if (bodyEnd < 0) continue;
    const kind = match[1];
    functions.push({
      name: kind === "constructor" ? "constructor" : match[2] ?? kind,
      start: headerStart,
      bodyStart: open + 1,
      bodyEnd,
      text: source.slice(open + 1, bodyEnd),
    });
    declaration.lastIndex = bodyEnd + 1;
  }
  return functions;
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function findCachedDomainIssues(
  source: string,
  structural: string,
  functions: FunctionBody[],
): SignatureSecurityFinding[] {
  const initializers = functions.filter(
    (fn) => fn.name === "constructor" || /^initialize(?:[A-Z0-9_].*)?$/i.test(fn.name),
  );
  const cachedConstruction = initializers.find(
    (fn) =>
      /\bblock\s*\.\s*chainid\b/i.test(fn.text) &&
      /(?:DOMAIN_SEPARATOR|domainSeparator|cachedDomainSeparator)/i.test(fn.text),
  );
  if (!cachedConstruction) return [];

  const hasRefresh = /\bblock\s*\.\s*chainid\s*(?:==|!=)\s*[A-Za-z_$][\w$]*/i.test(structural) &&
    /(?:_buildDomainSeparator|buildDomainSeparator|domainSeparator|DOMAIN_SEPARATOR)/i.test(structural);
  if (hasRefresh) return [];

  const chainIdIndex = cachedConstruction.bodyStart +
    Math.max(0, cachedConstruction.text.search(/\bblock\s*\.\s*chainid\b/i));
  const proxyHint = /\b(?:initializer|upgradeable|proxy|delegatecall)\b/i.test(source);
  return [
    makeFinding({
      source,
      index: chainIdIndex,
      ruleId: DOMAIN_RULE,
      severity: Severity.HIGH,
      message: "Domain separator is cached with the deployment chain ID but no runtime chain-ID refresh was found; a fork or cross-chain deployment can leave signatures bound to stale domain data.",
      suggestedFix: "Cache the chain ID and verifying contract alongside the separator, and rebuild the domain separator when either differs at verification time. For proxies, initialize and cache against each proxy address.",
      confidence: "medium",
      evidence: [
        `A constructor/initializer caches a domain value using block.chainid at line ${lineAt(source, chainIdIndex)}.`,
        proxyHint
          ? "Upgradeable/proxy indicators are present; verify that domain initialization runs in proxy storage."
          : "No chain-ID comparison with a domain-separator rebuild was found.",
      ],
    }),
  ];
}

function findStructHashIssues(source: string, structural: string): SignatureSecurityFinding[] {
  const hashes = new Map<string, TypeHash>();
  const constantPattern =
    /\bbytes32\s+(?:(?:public|private|internal|override)\s+)*constant\s+([A-Za-z_$][\w$]*TYPEHASH)\s*=\s*keccak256\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (let match = constantPattern.exec(source); match; match = constantPattern.exec(source)) {
    const typeFields = match[2].match(/^[^(]*\(([^)]*)\)/);
    if (!typeFields) continue;
    const fields = typeFields[1]
      .split(",")
      .map((field) => field.trim().match(/^(.*?)\s+([A-Za-z_$][\w$]*)$/))
      .filter((field): field is RegExpMatchArray => field !== null)
      .map((field) => ({ type: field[1].trim(), name: field[2] }));
    if (fields.length > 0) hashes.set(match[1], { identifier: match[1], fields });
  }

  if (hashes.size === 0) return [];
  const findings: SignatureSecurityFinding[] = [];
  const encodePattern = /\babi\s*\.\s*encode(Packed)?\s*\(/g;
  const reported = new Set<string>();
  for (let match = encodePattern.exec(structural); match; match = encodePattern.exec(structural)) {
    const open = structural.indexOf("(", match.index);
    const close = matchingParen(structural, open);
    if (close < 0) continue;
    const expression = structural.slice(open + 1, close);
    const args = splitTopLevel(expression);
    const candidate = Array.from(hashes.values()).find((typeHash) =>
      new RegExp(`\\b${escapeRegExp(typeHash.identifier)}\\b`).test(expression),
    );
    if (!candidate) continue;

    const fieldArguments = args.slice(1);
    const argumentIndex = new Map(
      candidate.fields.map((field) => [
        field.name,
        fieldArguments.findIndex((argument) =>
          new RegExp(`\\b${escapeRegExp(field.name)}\\b`).test(argument),
        ),
      ]),
    );
    const included = candidate.fields.filter(
      (field) => (argumentIndex.get(field.name) ?? -1) >= 0,
    );
    const missing = candidate.fields.filter((field) => !included.includes(field));
    const ordered = candidate.fields.every(
      (field, index) =>
        index === 0 ||
        (argumentIndex.get(candidate.fields[index - 1].name) ?? -1) <
          (argumentIndex.get(field.name) ?? -1),
    );
    if (missing.length > 0 || !ordered) {
      const key = `${candidate.identifier}:${match.index}:fields`;
      if (!reported.has(key)) {
        reported.add(key);
        const detail = missing.length > 0
          ? `does not encode declared field${missing.length > 1 ? "s" : ""}: ${missing.map((field) => field.name).join(", ")}`
          : `encodes declared fields out of order (expected ${candidate.fields.map((field) => field.name).join(", ")})`;
        findings.push(
          makeFinding({
            source,
            index: match.index,
            ruleId: HASH_RULE,
            severity: Severity.HIGH,
            message: `EIP-712 struct hash for ${candidate.identifier} ${detail}.`,
            suggestedFix: "Encode every field in the declared EIP-712 type, in the same order and with the specified type semantics; hash nested structs and dynamic arrays as prescribed by EIP-712.",
            confidence: "high",
            evidence: [
              `The type hash declares: ${candidate.fields.map((field) => field.name).join(", ")}.`,
              `This abi.encode call references, in order: ${candidate.fields.filter((field) => (argumentIndex.get(field.name) ?? -1) >= 0).sort((a, b) => (argumentIndex.get(a.name) ?? -1) - (argumentIndex.get(b.name) ?? -1)).map((field) => field.name).join(", ") || "none of the declared fields"}.`,
            ],
          }),
        );
      }
    }

    if (match[1] && args.length > 1) {
      const dynamicFields = candidate.fields.filter(
        (field) => /^(?:string|bytes)(?:\[\])?$/.test(field.type) || /\[\]$/.test(field.type),
      );
      const packedDynamic = dynamicFields.filter((field) =>
        fieldArguments.some(
          (argument) =>
            new RegExp(`\\b${escapeRegExp(field.name)}\\b`).test(argument) &&
            !/\b(?:keccak256|_?hash[A-Za-z0-9_$]*)\s*\(/i.test(argument),
        ),
      );
      const key = `${candidate.identifier}:${match.index}:packed`;
      if (packedDynamic.length > 0 && !reported.has(key)) {
        reported.add(key);
        findings.push(
          makeFinding({
            source,
            index: match.index,
            ruleId: HASH_RULE,
            severity: Severity.HIGH,
            message: `abi.encodePacked is used to hash dynamic EIP-712 field${packedDynamic.length > 1 ? "s" : ""} (${packedDynamic.map((field) => field.name).join(", ")}), creating ambiguous concatenation risk.`,
            suggestedFix: "Use abi.encode and the EIP-712 dynamic-field encoding rules (keccak256 for string/bytes and recursively hashed arrays/structs).",
            confidence: "high",
            evidence: [
              `The type hash declares dynamic field${packedDynamic.length > 1 ? "s" : ""}: ${packedDynamic.map((field) => field.name).join(", ")}.`,
              "The hash expression uses abi.encodePacked with additional encoded values.",
            ],
          }),
        );
      }
    }
  }
  return findings;
}

function findWeakSigningIssues(
  source: string,
  _structural: string,
  functions: FunctionBody[],
): SignatureSecurityFinding[] {
  const findings: SignatureSecurityFinding[] = [];
  for (const fn of functions) {
    const recover = /\becrecover\s*\(/i.exec(fn.text);
    if (!recover || !isAuthorizationFlow(fn.text, fn.name)) continue;
    const body = source.slice(fn.bodyStart, fn.bodyEnd);
    const typedData = /(?:_hashTypedDataV4|\bDOMAIN_SEPARATOR\b|\bdomainSeparator\b|\\x19\\x01)/i.test(body);
    const personalPrefix = /Ethereum Signed Message|personal_sign|\\x19Ethereum/i.test(body);
    if (typedData && !personalPrefix) continue;
    const index = fn.bodyStart + recover.index;
    findings.push(
      makeFinding({
        source,
        index,
        ruleId: PERSONAL_SIGN_RULE,
        severity: Severity.HIGH,
        message: personalPrefix
          ? "An authorization flow verifies an Ethereum Signed Message signature without an EIP-712 application domain."
          : "An authorization flow verifies a raw message hash with ecrecover and no EIP-712 domain binding.",
        suggestedFix: "Migrate authorization messages to EIP-712 typed data with a domain containing the chain ID and verifying contract; include all action and replay-protection fields.",
        confidence: "medium",
        evidence: [
          personalPrefix
            ? "The function contains the personal_sign/EIP-191 message prefix."
            : "The function calls ecrecover without a recognized typed-data domain construction.",
          "The same function compares the recovered signer in an authorization check and performs or names a privileged action.",
        ],
      }),
    );
  }
  return findings;
}

function findErc1271Issues(
  source: string,
  functions: FunctionBody[],
): SignatureSecurityFinding[] {
  const findings: SignatureSecurityFinding[] = [];
  for (const fn of functions) {
    const recover = /\becrecover\s*\(/i.exec(fn.text);
    if (
      !recover ||
      !isAuthorizationFlow(fn.text, fn.name) ||
      /\b(?:isValidSignature|IERC1271)\b/i.test(fn.text)
    ) {
      continue;
    }
    findings.push(
      makeFinding({
        source,
        index: fn.bodyStart + recover.index,
        ruleId: ERC1271_RULE,
        severity: Severity.MEDIUM,
        message: "This ECDSA-only authorization path does not validate contract-wallet signatures; this is a signer-compatibility gap, not evidence of an authorization bypass.",
        suggestedFix: "When contract signers are supported, use ERC-1271 isValidSignature for contract accounts and retain ECDSA recovery for EOAs. Document the accepted signer types.",
        confidence: "medium",
        evidence: [
          "The authorization function recovers an EOA signer with ecrecover.",
          "The function does not call isValidSignature or IERC1271.",
        ],
        issueType: "compatibility-gap",
      }),
    );
  }
  return findings;
}

function isAuthorizationFlow(body: string, functionName: string): boolean {
  const hasRecoveryCheck =
    /\b(?:require|assert)\s*\([^;]*(?:signer|recovered|recoveredAddress|ecrecover|owner|authorized)/i.test(body);
  const actionName =
    /\b(?:auth|authoriz\w*|permit|verify|execute|transfer|withdraw|claim|approve|admin|owner)\b/i.test(
      functionName,
    );
  const action = /\b(?:transfer|safeTransfer|withdraw|claim|execute|approve)\b|(?:\w+\s*\[[^\]]+\]\s*=)/i.test(body);
  return hasRecoveryCheck && (actionName || action);
}

function makeFinding(input: {
  source: string;
  index: number;
  ruleId: string;
  severity: Severity;
  message: string;
  suggestedFix: string;
  confidence: "medium" | "high";
  evidence: string[];
  issueType?: "compatibility-gap";
}): SignatureSecurityFinding {
  const startLine = lineAt(input.source, input.index);
  return {
    ruleId: input.ruleId,
    message: input.message,
    severity: input.severity,
    startLine,
    endLine: startLine,
    suggestedFix: input.suggestedFix,
    confidence: input.confidence,
    evidence: input.evidence,
    issueType: input.issueType,
  };
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "(" || source[i] === "[" || source[i] === "{") depth++;
    if (source[i] === ")" || source[i] === "]" || source[i] === "}") depth--;
    if (source[i] === "," && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (source.slice(start).trim()) parts.push(source.slice(start).trim());
  return parts;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
