/**
 * Block data used as randomness in high-value decisions (#1372)
 *
 * Traces block-derived values (block.timestamp, block.number, blockhash, block.prevrandao,
 * block.difficulty, block.coinbase, `now`) through local assignments and hashes into outcome
 * selection: `% n`, array indexing, threshold comparisons and returned "random" values.
 * Timestamps used only for deadlines, expiry and accounting (comparisons with deadlines,
 * `+ duration`, `- lastUpdate`) never reach a selection and are not reported.
 *
 * Why these sources are unsuitable against an adversary:
 *  - block.timestamp: the proposer can shift it within the accepted window, and any contract
 *    that runs in the same block sees the same value.
 *  - block.number: public and predictable; callers can simply wait for a favorable block.
 *  - blockhash: known to a contract calling in the same block (the current block's hash is 0),
 *    and zero for blocks older than 256.
 *  - block.prevrandao / block.difficulty: visible to every contract in the block and biasable by
 *    a proposer who skips a slot; better than the others but not a secure random source.
 *  - block.coinbase: chosen by the proposer.
 * A function named fulfillRandomWords (Chainlink VRF style) that uses its randomWords argument is safe.
 *
 * Supported: Solidity 0.8.x source text, single file. Randomness hidden behind other function calls is not traced.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  collectAssignments,
  extractFunctions,
  failedResult,
  mentionsWord,
  splitStatements,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "time-timestamp-randomness";

export const LIMITATIONS = [
  "Block-derived values are traced through local assignments in one function; values passed through other functions, storage or return values are not followed.",
  "A hash or modulo of a block value is treated as outcome selection; a deliberately weak non-adversarial use (cosmetic effects) still reports at lower severity.",
  "Value impact is inferred from transfers, minting and names such as winner, prize, jackpot, raffle, lottery, reward and loot in the same function.",
  "Commit-reveal and VRF patterns are recognised only by the fulfillRandomWords convention and by the absence of block data in the selection.",
];

const SUGGESTION =
  "Use a verifiable random function (for example Chainlink VRF) or a commit-reveal scheme with a delay; never derive winners or valuable outcomes from block data.";

const SOURCE_PATTERNS: Array<{ name: string; re: RegExp; why: string; weight: number }> = [
  { name: "block.timestamp", re: /\bblock\.timestamp\b|\bnow\b/, why: "the proposer can shift the timestamp within the accepted window and same-block contracts see the same value", weight: 3 },
  { name: "block.number", re: /\bblock\.number\b/, why: "the block number is public and predictable, so a caller can wait for a favorable block", weight: 3 },
  { name: "blockhash", re: /\bblockhash\s*\(/, why: "a contract in the same block can read it (the current block's hash is 0), and it is 0 for blocks older than 256", weight: 3 },
  { name: "block.coinbase", re: /\bblock\.coinbase\b/, why: "the block proposer chooses the coinbase address", weight: 3 },
  { name: "block.difficulty", re: /\bblock\.difficulty\b/, why: "after the merge it is an alias for prevrandao: visible in the block and biasable by a proposer who skips a slot", weight: 2 },
  { name: "block.prevrandao", re: /\bblock\.prevrandao\b/, why: "it is visible to every contract in the block and a proposer can bias it by skipping a slot", weight: 2 },
];

const VALUE_RE = /(\.transfer\s*\(|\.send\s*\(|\.call\s*\{|\bsafeTransfer\w*\s*\(|\b_?mint\s*\(|\bwinner\b|\bprize\b|\bjackpot\b|\braffle\b|\blottery\b|\breward\w*\b|\bloot\b|\brarity\b|\bpayout\b)/i;
const HASH_RE = /\b(?:keccak256|sha256|ripemd160)\s*\(|abi\.encode/;

function sourcesIn(text: string): string[] {
  return SOURCE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function detectTimestampRandomness(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];

  for (const fn of extractFunctions(v.clean)) {
    if (/^fulfillRandomWords$|^rawFulfillRandomWords$/.test(fn.name)) continue;
    const statements = splitStatements(fn, v.clean);
    const assignments = collectAssignments(statements);
    const highValue = VALUE_RE.test(fn.body) || VALUE_RE.test(fn.name);

    // Variables that carry block data, with the sources they came from.
    const blockVars = new Map<string, Set<string>>();
    for (let pass = 0; pass < 6; pass++) {
      for (const a of assignments) {
        const srcs = new Set(sourcesIn(a.rhs));
        for (const w of wordsIn(a.rhs)) for (const s of blockVars.get(w) ?? []) srcs.add(s);
        if (srcs.size === 0) continue;
        const known = blockVars.get(a.lhs) ?? new Set<string>();
        srcs.forEach((s) => known.add(s));
        blockVars.set(a.lhs, known);
      }
    }
    // Variables that already hold a reported outcome are not reported again downstream.
    const consumed = new Set<string>();
    const tracked = (text: string): string[] => {
      const out = new Set(sourcesIn(text));
      for (const w of wordsIn(text)) {
        if (consumed.has(w)) continue;
        for (const s of blockVars.get(w) ?? []) out.add(s);
      }
      return [...out];
    };

    statements.forEach((s, index) => {
      if (s.kind === "close") return;
      const text = s.text;
      const reasons: string[] = [];
      const percent = /([^%]*)%\s*([^%]+)/.exec(text);
      if (percent) {
        const leftSources = tracked(percent[1]);
        if (leftSources.length > 0) reasons.push("used as the left side of a modulo");
      }
      for (const idx of text.matchAll(/\[([^\[\]]*)\]/g)) {
        if (tracked(idx[1]).length > 0) reasons.push("used as an array index");
      }
      const cmp = /(<=|>=|==|<|>)/.test(text.replace(/[-=]>/g, ""));
      if (cmp && HASH_RE.test(text) && tracked(text).length > 0 && /^(?:if|require|assert)\b/.test(text)) reasons.push("a hash of block data is compared with a threshold");
      if (/^return\b/.test(text) && HASH_RE.test(text) && tracked(text).length > 0 && /(rand|seed|lottery|pick|draw|roll|shuffle)/i.test(fn.name)) reasons.push("returned as a random value");
      if (/^return\b/.test(text) && percent && tracked(percent[1]).length > 0 && /(rand|seed|roll)/i.test(fn.name)) reasons.push("returned as a random value");
      if (reasons.length === 0) return;

      const sources = tracked(text);
      const assignedName = assignments.find((a) => a.statementIndex === index)?.lhs;
      if (assignedName) consumed.add(assignedName);
      const weight = Math.max(...sources.map((n) => SOURCE_PATTERNS.find((p) => p.name === n)?.weight ?? 3));
      const severity: DetectorFinding["severity"] = highValue ? (weight >= 3 ? "high" : "medium") : weight >= 3 ? "medium" : "low";
      const why = sources.map((n) => `${n}: ${SOURCE_PATTERNS.find((p) => p.name === n)?.why}`);
      findings.push({
        ruleId: RULE_ID,
        severity,
        confidence: "high",
        title: "Block data used as a source of randomness",
        message: `${sources.join(", ")} feeds an outcome decision in ${fn.name}() (${[...new Set(reasons)].join("; ")}); block data is not suitable as adversarial randomness${highValue ? " and this function moves value or assigns a prize" : ""}.`,
        line: s.line,
        endLine: s.line,
        functionName: fn.name,
        evidence: [text, ...why, ...(assignedName && mentionsWord(fn.body, assignedName) ? [`result stored in ${assignedName}`] : []), highValue ? "high-value context: transfers, minting or prize/winner names in this function" : "no transfer or prize context found in this function"],
        rationale: highValue
          ? "A validator or a calling contract can predict or bias the value and capture the prize; severity follows the strength of the source."
          : "The outcome may not move funds directly, so severity is reduced.",
        remediation: "Use Chainlink VRF or commit-reveal; if randomness is cosmetic only, document that and cap what it can award.",
      });
    });
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
