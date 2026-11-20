/**
 * Signatures that omit contract-specific domain separation (#1375)
 *
 * For every signature check (ecrecover, ECDSA.recover/tryRecover, SignatureChecker.
 * isValidSignatureNow, isValidSignature) the detector resolves the signed digest, follows local
 * assignments and one level of in-file hashing helpers, and decides whether the signed payload
 * is bound to its domain:
 *  - EIP-712: `_hashTypedDataV4`, `toTypedDataHash`, a DOMAIN_SEPARATOR / domainSeparator value
 *    or the `\x19\x01` prefix counts as domain binding,
 *  - equivalent custom binding: the payload contains both `address(this)` (contract) and
 *    `block.chainid` / a chainId value (chain),
 *  - only one of the two is a partial binding: replayable across chains (no chain id) or across
 *    contracts (no contract address); neither is replayable across both.
 * An `EIP712Domain(...)` type string that omits chainId or verifyingContract is reported too.
 *
 * Replay protection by nonce is a different property and is covered by `sig-nonce-reuse`;
 * this rule reports only the missing domain binding, once per signature check.
 *
 * Supported: Solidity 0.8.x source text, single file; hashing helpers are resolved by name inside the file.
 */
import {
  DetectorFinding,
  DetectorResult,
  SolidityFunction,
  Statement,
  buildResult,
  collectAssignments,
  extractFunctions,
  failedResult,
  findMatching,
  makeLineIndex,
  splitStatements,
  splitTopLevel,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "sig-missing-domain-separation";

export const LIMITATIONS = [
  "Hashing helpers are resolved by name inside this file only; digests built in inherited contracts or libraries are treated as unbound unless they use a recognised EIP-712 helper.",
  "The payload is searched textually: a value merely mentioned (for example in a comment-free dead branch) counts as bound.",
  "Domain binding that depends on a stored value (an immutable named something other than domainSeparator) is not recognised; name it DOMAIN_SEPARATOR or domainSeparator or use _hashTypedDataV4.",
  "Chain-specific deployments that intentionally omit chainId (single-chain contracts) are still reported as partial binding.",
];

const SUGGESTION =
  "Use EIP-712 (OpenZeppelin EIP712 + _hashTypedDataV4) or include both block.chainid and address(this) in every signed payload.";

const TYPED_RE = /_hashTypedDataV4|hashTypedData|toTypedDataHash|_domainSeparatorV4|domain_?separator|EIP712Domain/i;
const CONTRACT_RE = /address\s*\(\s*this\s*\)|\bverifyingContract\b/;
const CHAIN_RE = /block\.chainid|\bchainid\s*\(\s*\)|\bchain_?id\b|\bCHAIN_ID\b/i;
const CALL_RE = /(?:\b(?:ecrecover|tryRecover)|\bECDSA\.(?:recover|tryRecover)|\.recover|\brecover|\bSignatureChecker\.isValidSignatureNow|\bisValidSignatureNow|\bisValidSignature)\s*\(/g;

function argsOf(text: string, openIndex: number): string[] {
  const close = findMatching(text, openIndex, "(", ")");
  return close < 0 ? [] : splitTopLevel(text.slice(openIndex + 1, close)).map((a) => a.trim());
}

export function detectMissingDomainSeparation(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const original = typeof code === "string" ? code : "";
  const lineOf = makeLineIndex(original);
  const findings: DetectorFinding[] = [];
  const fns = extractFunctions(v.clean);
  const byName = new Map<string, SolidityFunction>();
  for (const f of fns) if (!byName.has(f.name)) byName.set(f.name, f);

  // EIP712Domain type strings must name chainId and verifyingContract.
  for (const m of original.matchAll(/EIP712Domain\s*\(([^)]*)\)/g)) {
    const fields = m[1];
    const line = lineOf(m.index ?? 0);
    const missing: string[] = [];
    if (!/\bchainId\b/.test(fields)) missing.push("chainId");
    if (!/\bverifyingContract\b/.test(fields)) missing.push("verifyingContract");
    if (missing.length > 0) {
      findings.push({
        ruleId: RULE_ID,
        severity: "medium",
        confidence: "high",
        title: "EIP712Domain type omits domain fields",
        message: `The EIP712Domain type string omits ${missing.join(" and ")}, so signatures are not bound to ${missing.includes("chainId") ? "a chain" : ""}${missing.length === 2 ? " or " : ""}${missing.includes("verifyingContract") ? "a contract" : ""}.`,
        line,
        endLine: line,
        evidence: [m[0].replace(/\s+/g, " ")],
        rationale: "A domain separator without chainId or verifyingContract lets signatures replay across chains or contracts.",
        remediation: "Declare EIP712Domain(string name,string version,uint256 chainId,address verifyingContract) and hash all fields.",
      });
    }
  }

  const resolve = (fn: SolidityFunction, statements: Statement[], index: number, expr: string, depth: number, seen: Set<string>): string => {
    let text = expr;
    const assignments = collectAssignments(statements);
    for (const w of wordsIn(expr)) {
      if (seen.has(`${fn.name}:${w}`)) continue;
      seen.add(`${fn.name}:${w}`);
      for (const a of assignments) {
        if (a.lhs === w && a.statementIndex < index) text += " " + resolve(fn, statements, a.statementIndex, a.rhs, depth, seen);
      }
      const callee = byName.get(w);
      if (callee && callee !== fn && depth < 3 && new RegExp(`\\b${w}\\s*\\(`).test(expr)) {
        const calleeStatements = splitStatements(callee, v.clean);
        text += " " + callee.body;
        for (let i = 0; i < calleeStatements.length; i++) {
          const st = calleeStatements[i];
          if (/^return\b/.test(st.text)) text += " " + resolve(callee, calleeStatements, i, st.text.replace(/^return\s+/, ""), depth + 1, seen);
        }
      }
    }
    return text;
  };

  for (const fn of fns) {
    const statements = splitStatements(fn, v.clean);
    statements.forEach((s, index) => {
      if (s.kind === "close") return;
      CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CALL_RE.exec(s.text)) !== null) {
        const open = m.index + m[0].length - 1;
        const args = argsOf(s.text, open);
        const isChecker = /isValidSignatureNow/.test(m[0]);
        const digestExpr = isChecker ? args[1] : args[0];
        if (!digestExpr) continue;
        const payload = resolve(fn, statements, index, digestExpr, 0, new Set());
        const origBody = original.slice(fn.bodyStart, fn.bodyStart + fn.body.length);
        const typed = TYPED_RE.test(payload) || TYPED_RE.test(origBody) || /\\x19\\x01|hex\s*"1901"/.test(origBody);
        const contract = CONTRACT_RE.test(payload);
        const chain = CHAIN_RE.test(payload);
        if (typed || (contract && chain)) continue;

        const fields: string[] = [];
        for (const e of payload.matchAll(/abi\.encode(?:Packed)?\s*\(/g)) {
          const idx = (e.index ?? 0) + e[0].length - 1;
          fields.push(...argsOf(payload, idx).filter((a) => /^[A-Za-z_$][\w$.]*$/.test(a)));
        }
        const kind = contract ? "chain" : chain ? "contract" : "both";
        const missing = kind === "both" ? "the contract address and the chain id" : kind === "chain" ? "the chain id" : "the contract address";
        const replay = kind === "both" ? "across contracts and across chains" : kind === "chain" ? "across chains (fork or other deployment)" : "across contracts that share the signer's format";
        findings.push({
          ruleId: RULE_ID,
          severity: kind === "both" ? "high" : "medium",
          confidence: "medium",
          title: "Signed payload is not bound to a contract or chain domain",
          message: `The signature checked in ${fn.name}() covers a payload without ${missing}, so the same signature can be replayed ${replay}.`,
          line: s.line,
          endLine: s.line,
          functionName: fn.name,
          evidence: [s.text, `signed fields: ${[...new Set(fields)].join(", ") || "not resolved"}`, `missing binding: ${missing}`, "no EIP-712 domain separator or equivalent was found in the signed payload"],
          rationale: kind === "both" ? "Nothing ties the signature to this contract or chain; severity high." : "The signature is only partially bound; severity medium.",
          remediation: "Hash through _hashTypedDataV4 (EIP-712), or include block.chainid and address(this) in the signed data.",
        });
      }
    });
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
