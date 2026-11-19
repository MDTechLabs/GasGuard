/**
 * block.number assumptions across L2 and sidechain deployments (#1373)
 *
 * Finds logic that assumes block numbers map consistently to elapsed time or security
 * guarantees:
 *  - fixed block-count delays (`block.number + 50400`, `*_BLOCKS` constants) used for locks,
 *    timelocks, cooldowns, challenge windows, confirmations or finality,
 *  - block-number-to-time conversions (`block.number * 12`, `blocks * SECONDS_PER_BLOCK`,
 *    `block.number / BLOCKS_PER_DAY`).
 * The same block count lasts a different time on different chains, so findings describe
 * deployment-dependent behavior, not a universal exploit: each one lists what the delay
 * amounts to on every target chain of the configured profile.
 *
 * Chain profile: `options.chains` selects target chains (default: ethereum, optimism, base,
 * arbitrum, polygon) and `options.profiles` overrides or adds profiles with `blockTimeSeconds`.
 * The built-in block times are approximate defaults, not guarantees; set them for your deployment.
 * The profile used is always reported in an info diagnostic.
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  Diagnostic,
  buildResult,
  extractFunctions,
  failedResult,
  splitStatements,
  validateSource,
} from "../_shared/solidity-source";

export const RULE_ID = "time-block-number-assumptions";

export interface ChainProfile {
  blockTimeSeconds: number;
  note?: string;
}

export interface BlockNumberOptions {
  chains?: string[];
  profiles?: Record<string, ChainProfile>;
}

export const DEFAULT_PROFILES: Record<string, ChainProfile> = {
  ethereum: { blockTimeSeconds: 12 },
  optimism: { blockTimeSeconds: 2, note: "block.number is the L2 block number" },
  base: { blockTimeSeconds: 2, note: "block.number is the L2 block number" },
  arbitrum: {
    blockTimeSeconds: 12,
    note: "block.number reports an approximation of the L1 block number, not the L2 block count (ArbSys.arbBlockNumber() gives the L2 number); check the current Arbitrum documentation",
  },
  polygon: { blockTimeSeconds: 2 },
};

export const DEFAULT_CHAINS = ["ethereum", "optimism", "base", "arbitrum", "polygon"];

export const LIMITATIONS = [
  "Built-in block times are approximate defaults; real block times vary and change with network upgrades. Override them with options.profiles.",
  "The intended duration of a block-count constant is unknown unless its name says so (BLOCKS_PER_DAY, SECONDS_PER_BLOCK); other counts are reported as a per-chain table.",
  "Only block.number arithmetic and named block-count constants in this file are analyzed.",
  "Comparisons of block.number with a stored block number for ordering or same-block checks (distance 0 or 1) are deployment-agnostic and ignored.",
];

const SUGGESTION =
  "Use block.timestamp (with an explicit duration in seconds) for time-based rules, or make the block time a per-chain configuration value and document the chain assumptions.";

function formatDuration(seconds: number): string {
  if (seconds >= 2 * 86400) return `${trim(seconds / 86400)}d`;
  if (seconds >= 3600) return `${trim(seconds / 3600)}h`;
  if (seconds >= 60) return `${trim(seconds / 60)}min`;
  return `${trim(seconds)}s`;
}
function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

const CONTEXT_RE = /(lock|vest|unlock|delay|timelock|cooldown|challenge|finality|confirm|expir|deadline|reveal|commit|window|period|epoch)/i;
const DELAY_NAME = /(blocks?)$|delay_?blocks|block_?delay|confirmations|finality/i;
const PER_TIME: Array<[RegExp, number]> = [
  [/BLOCKS?_PER_(?:DAY)|blocksPerDay/i, 86400],
  [/BLOCKS?_PER_(?:HOUR)|blocksPerHour/i, 3600],
  [/BLOCKS?_PER_(?:WEEK)|blocksPerWeek/i, 604800],
  [/BLOCKS?_PER_(?:YEAR)|blocksPerYear/i, 31536000],
];
const SECONDS_PER_BLOCK = /^(?:SECONDS_PER_BLOCK|BLOCK_TIME(?:_SECONDS)?|secondsPerBlock|blockTime(?:Seconds)?)$/;

interface Constant {
  name: string;
  value: number;
  kind: "blocks-per-time" | "seconds-per-block" | "block-delay";
  impliedSeconds?: number;
}

export function detectBlockNumberAssumptions(code: string, options: BlockNumberOptions = {}): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const diagnostics: Diagnostic[] = [...v.diagnostics];

  const profiles: Record<string, ChainProfile> = { ...DEFAULT_PROFILES };
  for (const [name, p] of Object.entries(options.profiles ?? {})) {
    if (p && typeof p.blockTimeSeconds === "number" && Number.isFinite(p.blockTimeSeconds) && p.blockTimeSeconds > 0) profiles[name] = p;
    else diagnostics.push({ level: "warning", message: `Ignoring chain profile "${name}": blockTimeSeconds must be a positive number.` });
  }
  let chains = (options.chains ?? DEFAULT_CHAINS).filter((c) => {
    const known = c in profiles;
    if (!known) diagnostics.push({ level: "warning", message: `Unknown chain "${c}" skipped; define it in options.profiles.` });
    return known;
  });
  if (chains.length === 0) {
    diagnostics.push({ level: "warning", message: "No valid target chains configured; using the default chain profile." });
    chains = DEFAULT_CHAINS;
  }
  diagnostics.push({
    level: "info",
    message: `Chain profile used: ${chains.map((c) => `${c} (${profiles[c].blockTimeSeconds}s per block${profiles[c].note ? `; ${profiles[c].note}` : ""})`).join("; ")}.`,
  });

  const constants = new Map<string, Constant>();
  const constRe = /\b([A-Za-z_$][\w$]*)\s*=\s*(\d[\d_]*)\s*;/g;
  let cm: RegExpExecArray | null;
  while ((cm = constRe.exec(v.clean)) !== null) {
    const name = cm[1];
    const value = Number(cm[2].replace(/_/g, ""));
    const per = PER_TIME.find(([re]) => re.test(name));
    if (per) constants.set(name, { name, value, kind: "blocks-per-time", impliedSeconds: per[1] / value });
    else if (SECONDS_PER_BLOCK.test(name)) constants.set(name, { name, value, kind: "seconds-per-block", impliedSeconds: value });
    else if (DELAY_NAME.test(name) && value > 1) constants.set(name, { name, value, kind: "block-delay" });
  }

  const findings: DetectorFinding[] = [];
  const table = (blocks: number) => chains.map((c) => `${c}: ${formatDuration(blocks * profiles[c].blockTimeSeconds)}`).join(", ");
  const spread = (times: number[]) => Math.max(...times) / Math.min(...times) > 1.1;
  const noteFor = chains.filter((c) => profiles[c].note).map((c) => `${c}: ${profiles[c].note}`);

  for (const fn of extractFunctions(v.clean)) {
    for (const s of splitStatements(fn, v.clean)) {
      if (s.kind === "close") continue;
      const text = s.text;
      const context = CONTEXT_RE.test(text) || CONTEXT_RE.test(fn.name);
      const severity: DetectorFinding["severity"] = context ? "medium" : "low";
      const add = (title: string, message: string, evidence: string[]) =>
        findings.push({
          ruleId: RULE_ID,
          severity,
          confidence: "medium",
          title,
          message: `${message} (in ${fn.name}())`,
          line: s.line,
          endLine: s.line,
          functionName: fn.name,
          evidence: [text, ...evidence, ...noteFor],
          rationale: context
            ? "The block count controls a delay or security window whose real duration depends on the chain; deployment-dependent, severity medium."
            : "The block count has no delay or lock context in this statement; severity low.",
          remediation: "Use block.timestamp with a duration in seconds, or take the block time from per-chain configuration.",
        });

      // Conversions: block.number * X, blocks * SECONDS_PER_BLOCK, block.number / BLOCKS_PER_DAY.
      const mul = /\bblock\.number\b[^;]*?\*\s*(\d[\d_]*|[A-Za-z_$][\w$]*)|(\d[\d_]*|[A-Za-z_$][\w$]*)\s*\*\s*[^;]*?\bblock\.number\b/.exec(text);
      const viaConst = [...constants.values()].find((c) => c.kind !== "block-delay" && new RegExp(`\\b${c.name}\\b`).test(text));
      let implied: number | undefined;
      let basis = "";
      if (mul) {
        const operand = (mul[1] ?? mul[2] ?? "").replace(/_/g, "");
        if (/^\d+$/.test(operand)) {
          implied = Number(operand);
          basis = `block.number is multiplied by ${operand}`;
        } else if (constants.get(operand)?.kind === "seconds-per-block") {
          implied = constants.get(operand)!.impliedSeconds;
          basis = `block.number is multiplied by ${operand} (= ${implied}s)`;
        }
      } else if (viaConst && viaConst.impliedSeconds !== undefined) {
        implied = viaConst.impliedSeconds;
        basis = `${viaConst.name} implies ${trim(viaConst.impliedSeconds)}s per block`;
      }
      if (implied !== undefined && Number.isFinite(implied)) {
        const off = chains.filter((c) => Math.abs(profiles[c].blockTimeSeconds - implied!) / implied! > 0.1);
        if (off.length > 0) {
          add(
            "Block count converted to time with a fixed block time",
            `Assumes ${trim(implied)}s per block (${basis}); this does not hold on ${off.join(", ")}`,
            [`target chains: ${chains.map((c) => `${c}=${profiles[c].blockTimeSeconds}s`).join(", ")}`],
          );
        }
        continue;
      }

      // Fixed block-count delays.
      if (!/\bblock\.number\b/.test(text) && ![...constants.values()].some((c) => c.kind === "block-delay" && new RegExp(`\\b${c.name}\\b`).test(text))) continue;
      const delay = /\bblock\.number\b\s*(?:[+-]|[<>]=?)\s*(?:\w+\s*\+\s*)?(\d[\d_]*|[A-Z][A-Z0-9_]*|[a-z]\w*Blocks?)|(\d[\d_]*|[A-Z][A-Z0-9_]*)\s*(?:[+-])\s*\bblock\.number\b|(?:\+|[<>]=?)\s*(\d[\d_]*|[A-Z][A-Z0-9_]*)\b/.exec(text);
      const operand = (delay?.[1] ?? delay?.[2] ?? delay?.[3] ?? "").replace(/_/g, "");
      let blocks = /^\d+$/.test(operand) ? Number(operand) : constants.get(operand)?.kind === "block-delay" ? constants.get(operand)!.value : NaN;
      if (!Number.isFinite(blocks)) {
        const viaDelay = [...constants.values()].find((c) => c.kind === "block-delay" && new RegExp(`\\b${c.name}\\b`).test(text));
        if (viaDelay) blocks = viaDelay.value;
      }
      if (!Number.isFinite(blocks) || blocks <= 1) continue;
      if (!spread(chains.map((c) => profiles[c].blockTimeSeconds))) continue;
      add(
        "Fixed block-count delay depends on the chain's block time",
        `A delay of ${blocks} blocks lasts ${table(blocks)}`,
        [`${blocks} blocks`, `target chains: ${chains.join(", ")}`],
      );
    }
  }
  return buildResult(RULE_ID, findings, diagnostics, LIMITATIONS, SUGGESTION);
}
