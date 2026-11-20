/**
 * Timestamp units and scaling mismatches (#1371)
 *
 * Detects confusion between seconds, milliseconds, minutes/hours/days counts and block counts in
 * expiry, lockup, vesting, cooldown and rate-limit logic:
 *  - mixed units in one expression, for example `block.timestamp < deadlineMs`,
 *    `block.timestamp + lockDays`, `block.number < expirySeconds`,
 *  - `block.timestamp / 1000` (EVM timestamps are already seconds),
 *  - double scaling of values that are already in seconds (`LOCK_PERIOD * 1 days` where
 *    `LOCK_PERIOD = 7 days`).
 *
 * Units come from time literals (`7 days`), name suffixes (Ms, Seconds, Minutes, Hours, Days,
 * Blocks and the SCREAMING_CASE forms) and from constants initialised with time literals.
 * Explicit normalisation is respected and not flagged: `lockDays * 1 days`, `deadlineMs / 1000`,
 * `block.timestamp * 1000 <= deadlineMs`, `blocks * BLOCK_TIME`.
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  buildResult,
  extractFunctions,
  failedResult,
  mentionsWord,
  splitStatements,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "time-unit-mismatch";

export const LIMITATIONS = [
  "Units are inferred from literals and identifier names; an identifier named without a unit hint is treated as seconds only when it ends in a common time word (deadline, expiry, startTime, duration, ...).",
  "Normalisation is recognised only in the forms listed in the rule documentation; unusual helper functions are not followed.",
  "Block counts are never convertible to seconds without an explicit block-time constant (BLOCK_TIME, blockTime, SECONDS_PER_BLOCK).",
  "Values read from other contracts or storage structs carry no unit information and are ignored.",
];

const SUGGESTION =
  "Keep every time value in seconds (convert counts with `* 1 days` and milliseconds with `/ 1000`), and never compare block numbers with timestamps.";

type Unit = "seconds" | "milliseconds" | "minutes" | "hours" | "days" | "blocks";

const SECONDS_NAME = /(timestamp|deadline|expiry|expires|expiresAt|startTime|endTime|unlockTime|releaseTime|unlockAt|releaseAt|cliff|duration|period|delay|cooldown|lockup|lockTime)$|^(?:start|end)$/i;
const CONTEXT_RE = /(expir|deadline|lock|vest|cliff|cooldown|unlock|release|rate|limit|until|duration|delay)/i;
const KEYWORDS = new Set(["block", "timestamp", "number", "require", "return", "uint256", "uint64", "uint32", "uint128", "uint", "if", "else", "msg", "sender", "seconds", "minutes", "hours", "days", "weeks", "revert", "emit", "public", "private", "internal", "memory", "storage", "calldata"]);

function unitOfName(name: string): Unit | null {
  if (/(Ms|Millis|Milliseconds)$|_MS$|_MILLIS$|_MILLISECONDS$/.test(name)) return "milliseconds";
  if (/(Minutes?|Mins)$|_MINUTES?$|_MINS$/.test(name)) return "minutes";
  if (/(Hours?)$|_HOURS?$/.test(name)) return "hours";
  if (/(Days?)$|_DAYS?$/.test(name)) return "days";
  if (/(Blocks?)$|_BLOCKS?$/.test(name)) return "blocks";
  if (/(Seconds?|Secs?)$|_SECONDS?$|_SECS?$/.test(name)) return "seconds";
  if (SECONDS_NAME.test(name)) return "seconds";
  return null;
}

function normalizers(unit: Unit, id: string): RegExp | null {
  const e = id.replace(/[$]/g, "\\$");
  switch (unit) {
    case "milliseconds":
      return new RegExp(`\\b${e}\\s*/\\s*(?:1000|1e3|1_000|[A-Z_]*MILLIS[A-Z_]*|MS_PER_SECOND)\\b`);
    case "minutes":
      return new RegExp(`\\b${e}\\s*\\*\\s*(?:1\\s+minutes|60)\\b|\\b(?:1\\s+minutes|60)\\s*\\*\\s*${e}\\b`);
    case "hours":
      return new RegExp(`\\b${e}\\s*\\*\\s*(?:1\\s+hours|3600|3_600)\\b|\\b(?:1\\s+hours|3600|3_600)\\s*\\*\\s*${e}\\b`);
    case "days":
      return new RegExp(`\\b${e}\\s*\\*\\s*(?:1\\s+days|86400|86_400)\\b|\\b(?:1\\s+days|86400|86_400)\\s*\\*\\s*${e}\\b`);
    case "blocks":
      return new RegExp(`\\b${e}\\s*\\*\\s*\\w*(?:BLOCK_?TIME|blockTime|SECONDS_PER_BLOCK|secondsPerBlock)\\w*|\\w*(?:BLOCK_?TIME|blockTime|SECONDS_PER_BLOCK|secondsPerBlock)\\w*\\s*\\*\\s*${e}\\b`);
    default:
      return null;
  }
}

interface Operand {
  what: string;
  unit: Unit;
}

export function detectTimestampUnitMismatch(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const findings: DetectorFinding[] = [];

  // Constants and state variables initialised with a time literal are already seconds.
  const secondsConstants = new Set<string>();
  const initRe = /([A-Za-z_$][\w$]*)\s*=\s*([^;]*\b\d[\d_]*\s*(?:seconds|minutes|hours|days|weeks)\b[^;]*);/g;
  let im: RegExpExecArray | null;
  while ((im = initRe.exec(v.clean)) !== null) secondsConstants.add(im[1]);

  for (const fn of extractFunctions(v.clean)) {
    for (const s of splitStatements(fn, v.clean)) {
      if (s.kind === "close" || s.text.length === 0) continue;
      const text = s.text;
      const operands: Operand[] = [];
      const context = CONTEXT_RE.test(text) || CONTEXT_RE.test(fn.name);
      const report = (title: string, message: string, evidence: string[], severity: DetectorFinding["severity"], confidence: DetectorFinding["confidence"]) =>
        findings.push({
          ruleId: RULE_ID,
          severity: context ? severity : severity === "high" ? "medium" : severity,
          confidence,
          title,
          message: `${message} (in ${fn.name}())`,
          line: s.line,
          endLine: s.line,
          functionName: fn.name,
          evidence: [text, ...evidence],
          rationale: context
            ? "The value drives an expiry, lockup, vesting, cooldown or rate limit, so a unit error shifts it by orders of magnitude."
            : "No expiry or lockup context was found in the statement; severity reduced.",
          remediation: "Convert to seconds explicitly (`count * 1 days`, `ms / 1000`) and compare timestamps only with timestamps.",
        });

      // block.timestamp / 1000 : timestamps are already in seconds.
      if (/\bblock\.timestamp\s*\/\s*(?:1000|1e3|1_000)\b/.test(text)) {
        report("block.timestamp divided by 1000", "`block.timestamp / 1000` treats the EVM timestamp as milliseconds, but it is already in seconds, so the result is about 1000 times too small", ["EVM block.timestamp is seconds since the epoch"], "high", "high");
      }

      // Double scaling of values that are already seconds.
      const scale = "(?:\\d[\\d_]*\\s+(?:seconds|minutes|hours|days|weeks)|86400|86_400|3600|3_600|1000|1e3)";
      for (const c of secondsConstants) {
        if (new RegExp(`\\b${c}\\s*\\*\\s*${scale}\\b|\\b${scale}\\s*\\*\\s*${c}\\b`).test(text)) {
          report("Value already in seconds is scaled again", `\`${c}\` is initialised with a time literal (seconds) and is multiplied by another time factor here`, [`${c} is already in seconds`], "high", "high");
        }
      }

      // Mixed units in one expression.
      const tsMs = /\bblock\.timestamp\s*\*\s*(?:1000|1e3|1_000)\b/.test(text);
      if (tsMs) operands.push({ what: "block.timestamp * 1000", unit: "milliseconds" });
      else if (/\bblock\.timestamp\b|\bnow\b/.test(text) && !/\bblock\.timestamp\s*\/\s*(?:1000|1e3|1_000)\b/.test(text)) operands.push({ what: "block.timestamp", unit: "seconds" });
      if (/\bblock\.number\b/.test(text)) operands.push({ what: "block.number", unit: "blocks" });
      if (/\b\d[\d_]*\s+(?:seconds|minutes|hours|days|weeks)\b/.test(text)) operands.push({ what: "a time literal", unit: "seconds" });
      for (const w of wordsIn(text)) {
        if (KEYWORDS.has(w)) continue;
        const unit = secondsConstants.has(w) ? "seconds" : unitOfName(w);
        if (!unit || !mentionsWord(text, w)) continue;
        if (unit !== "seconds") {
          const n = normalizers(unit, w);
          if (n && n.test(text)) {
            operands.push({ what: `${w} (normalised)`, unit: "seconds" });
            continue;
          }
        }
        operands.push({ what: w, unit });
      }
      const units = Array.from(new Set(operands.map((o) => o.unit)));
      if (units.length >= 2) {
        const desc = operands.map((o) => `${o.what} [${o.unit}]`);
        const blocks = units.includes("blocks");
        report(
          blocks ? "Block count mixed with a time value" : "Mixed time units in one expression",
          `Time units are mixed (${units.join(" vs ")}): ${desc.join(", ")}`,
          desc,
          "high",
          operands.some((o) => o.what === "block.timestamp" || o.what === "block.number") ? "high" : "medium",
        );
      }
    }
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
