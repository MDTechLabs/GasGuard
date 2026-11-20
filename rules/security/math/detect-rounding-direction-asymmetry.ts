/**
 * Inconsistent rounding direction between deposits and withdrawals (#1370)
 *
 * Identifies the share/asset conversion paths of vault-style contracts (convertToShares,
 * deposit, mint, withdraw, redeem and their preview functions), records whether each rounds
 * down (floor) or up (ceiling), and compares that with the declared accounting policy.
 *
 * Policies (set with the `policy` option or a `// rounding-policy: <name>` comment):
 *  - protocol-favoring (default, the ERC-4626 convention): deposit / convertToShares /
 *    previewDeposit / redeem / previewRedeem / convertToAssets round DOWN; mint / previewMint /
 *    withdraw / previewWithdraw round UP. Anything else gives the user more than they paid for.
 *  - paired-only: only an action and its preview must agree.
 *  - none: report the directions without raising findings.
 * Asymmetric rounding that matches the declared policy is never flagged.
 *
 * Supported: Solidity 0.8.x source text, single file. Conversions are found by name, so
 * contracts with other function names need their own mapping.
 */
import {
  DetectorFinding,
  DetectorResult,
  Statement,
  buildResult,
  extractFunctions,
  failedResult,
  splitStatements,
  validateSource,
} from "../_shared/solidity-source";

export const RULE_ID = "arith-rounding-asymmetry";

export const LIMITATIONS = [
  "Conversion paths are recognised by ERC-4626-style function names; custom names are not mapped.",
  "Rounding is read from helper names (mulDivUp/Down, ceilDiv, Rounding.Up/Down), the (a + b - 1) / b idiom and plain division (floor).",
  "Functions that take a Rounding parameter choose the direction at the call site and are skipped.",
  "The comparison is syntactic: formulas that are mathematically equivalent but written differently are not unified.",
];

const SUGGESTION =
  "Round in the protocol's favor on every path: down when minting shares or paying out assets, up when charging assets or burning shares; keep previews identical to the action they preview.";

export type Policy = "protocol-favoring" | "paired-only" | "none";
export type Direction = "floor" | "ceil";

interface Role {
  re: RegExp;
  label: string;
  required: Direction;
  pair: string;
}

const ROLES: Role[] = [
  { re: /^_?convertToShares$/i, label: "convertToShares (assets in, shares out)", required: "floor", pair: "" },
  { re: /^_?deposit$/i, label: "deposit (assets in, shares out)", required: "floor", pair: "previewDeposit" },
  { re: /^_?previewDeposit$/i, label: "previewDeposit (assets in, shares out)", required: "floor", pair: "deposit" },
  { re: /^_?mint$/i, label: "mint (shares out, assets in)", required: "ceil", pair: "previewMint" },
  { re: /^_?previewMint$/i, label: "previewMint (shares out, assets in)", required: "ceil", pair: "mint" },
  { re: /^_?withdraw$/i, label: "withdraw (assets out, shares burned)", required: "ceil", pair: "previewWithdraw" },
  { re: /^_?previewWithdraw$/i, label: "previewWithdraw (assets out, shares burned)", required: "ceil", pair: "withdraw" },
  { re: /^_?redeem$/i, label: "redeem (shares in, assets out)", required: "floor", pair: "previewRedeem" },
  { re: /^_?previewRedeem$/i, label: "previewRedeem (shares in, assets out)", required: "floor", pair: "redeem" },
  { re: /^_?convertToAssets$/i, label: "convertToAssets (shares in, assets out)", required: "floor", pair: "" },
];

const CEIL_HELPER = /\b(?:mulDivUp|divUp|ceilDiv|mulDivRoundingUp|divRoundUp|mulDivCeil|wadMulUp|wadDivUp|rayMulUp|rayDivUp|mulWadUp|divWadUp)\b|Rounding\.(?:Up|Ceil|Expand)\b/;
const CEIL_IDIOM = /\(\s*[^()]*\+\s*[^()]*-\s*1\s*\)\s*\/|\(\s*\w+\s*-\s*1\s*\)\s*\/\s*[\w.]+\s*\+\s*1\b/;
const FLOOR_HELPER = /\b(?:mulDivDown|divDown|mulDiv|mulWadDown|divWadDown|wadMulDown|wadDivDown|rayMulDown|rayDivDown)\b|Rounding\.(?:Down|Floor|Trunc)\b/;
const RATE_WORDS = /(totalAssets|totalSupply|totalShares|reserve|pricePerShare|exchangeRate|sharePrice|\brate\b)/;

export function roundingOf(expr: string): Direction | null {
  if (CEIL_HELPER.test(expr) || CEIL_IDIOM.test(expr)) return "ceil";
  if (FLOOR_HELPER.test(expr) || /[^/*]\/[^/*]/.test(expr)) return "floor";
  return null;
}

export interface Conversion {
  functionName: string;
  label: string;
  direction: Direction;
  line: number;
  formula: string;
  rateKey: string;
  via?: string;
}

function rateKeyOf(expr: string): string {
  return Array.from(new Set(expr.match(new RegExp(RATE_WORDS.source, "g")) ?? [])).sort().join("+");
}

/** Lists the conversion paths of a contract with their rounding direction. */
export function analyzeRoundingPaths(code: string): Conversion[] {
  const v = validateSource(code);
  if (!v.ok) return [];
  const own = new Map<string, Conversion[]>();
  const calls = new Map<string, string[]>();
  const fns = extractFunctions(v.clean);
  for (const fn of fns) {
    const role = ROLES.find((r) => r.re.test(fn.name));
    if (!role) continue;
    if (/\bRounding\b/.test(fn.params.map((p) => p.type).join(" "))) continue; // direction chosen by the caller
    const statements: Statement[] = splitStatements(fn, v.clean);
    const list: Conversion[] = [];
    for (const s of statements) {
      if (s.kind !== "stmt" || !RATE_WORDS.test(s.text)) continue;
      const direction = roundingOf(s.text);
      if (!direction) continue;
      list.push({ functionName: fn.name, label: role.label, direction, line: s.line, formula: s.text, rateKey: rateKeyOf(s.text) });
    }
    own.set(fn.name, list);
    calls.set(fn.name, fns.map((f) => f.name).filter((n) => n !== fn.name && new RegExp(`\\b${n}\\s*\\(`).test(fn.body)));
  }
  const out: Conversion[] = [];
  for (const [name, list] of own) {
    if (list.length > 0) {
      out.push(...list);
      continue;
    }
    const target = (calls.get(name) ?? []).find((n) => (own.get(n) ?? []).length > 0);
    if (target) {
      const t = own.get(target)![0];
      const role = ROLES.find((r) => r.re.test(name))!;
      out.push({ ...t, functionName: name, label: role.label, via: target });
    }
  }
  return out;
}

export function detectRoundingAsymmetry(code: string, options: { policy?: Policy } = {}): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const declared = /rounding-policy:\s*([A-Za-z-]+)/.exec(typeof code === "string" ? code : "")?.[1];
  const policy: Policy = options.policy ?? (declared === "paired-only" || declared === "none" ? declared : "protocol-favoring");
  const diagnostics = [...v.diagnostics];
  if (declared && !["protocol-favoring", "paired-only", "none"].includes(declared) && !options.policy) {
    diagnostics.push({ level: "warning", message: `Unknown rounding-policy "${declared}"; using protocol-favoring.` });
  }
  const findings: DetectorFinding[] = [];
  const conversions = analyzeRoundingPaths(code);
  const byName = new Map<string, Conversion>();
  for (const c of conversions) if (!byName.has(c.functionName)) byName.set(c.functionName, c);

  if (policy !== "none") {
    for (const c of conversions) {
      const role = ROLES.find((r) => r.re.test(c.functionName));
      if (!role) continue;
      if (policy === "protocol-favoring" && c.direction !== role.required) {
        const isPreview = /preview/i.test(c.functionName);
        findings.push({
          ruleId: RULE_ID,
          severity: isPreview ? "medium" : "high",
          confidence: c.via ? "medium" : "high",
          title: "Rounding direction violates the protocol-favoring accounting policy",
          message: `${c.functionName}() [${role.label}] rounds ${c.direction === "ceil" ? "up" : "down"}${c.via ? ` (through ${c.via}())` : ""}, but the declared protocol-favoring policy requires rounding ${role.required === "ceil" ? "up" : "down"}; the user receives more value than they paid for.`,
          line: c.line,
          endLine: c.line,
          functionName: c.functionName,
          evidence: [c.formula, `rounding: ${c.direction}`, `required: ${role.required}`, `exchange-rate terms: ${c.rateKey || "none detected"}`, "a dust-sized deposit or a repeated deposit/withdraw loop extracts the rounding difference each round"],
          rationale: isPreview
            ? "A preview that disagrees with the real policy misleads integrators; severity medium."
            : "The rounding error favors the caller and can be repeated, so value moves systematically from the protocol to users; severity high.",
          remediation: `Round ${role.required === "ceil" ? "up (mulDivUp / Math.Rounding.Ceil)" : "down (mulDiv / Math.Rounding.Floor)"} in ${c.functionName}().`,
        });
      }
    }
    for (const role of ROLES) {
      if (!role.pair || policy !== "paired-only") continue;
      const a = byName.get(role.label.split(" ")[0]);
      const b = byName.get(role.pair);
      if (!a || !b || a.direction === b.direction) continue;
      if (!/preview/i.test(role.pair)) continue;
      findings.push({
        ruleId: RULE_ID,
        severity: "medium",
        confidence: "medium",
        title: "Action and preview round in different directions",
        message: `${a.functionName}() rounds ${a.direction === "ceil" ? "up" : "down"} but ${b.functionName}() rounds ${b.direction === "ceil" ? "up" : "down"}: the preview does not match what the action will do.`,
        line: b.line,
        endLine: b.line,
        functionName: b.functionName,
        evidence: [a.formula, b.formula],
        rationale: "Integrators and frontends rely on previews matching execution; a mismatch hides the real cost.",
        remediation: "Make the preview call the same conversion helper as the action.",
      });
    }
  }
  return buildResult(RULE_ID, dedupe(findings), diagnostics, LIMITATIONS, SUGGESTION);
}

function dedupe(findings: DetectorFinding[]): DetectorFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.functionName}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
