/**
 * Signature expiry checks with incorrect boundary comparisons (#1374)
 *
 * In functions that verify signatures, traces signed deadlines (deadline, expiry, validUntil, ...)
 * to the branch that validates them against block.timestamp and reports:
 *  - inverted checks (the signature is only accepted after the deadline),
 *  - inclusive/exclusive inconsistency between functions (`<=` in one, `<` in another), or a
 *    mismatch with the expected convention (option `expectedBoundary` or a
 *    `deadline-boundary: inclusive|exclusive` comment; the EIP-2612 convention is inclusive),
 *  - off-by-one adjustments (`deadline + 1`, `deadline - 1`),
 *  - a deadline that is signed but never compared with block.timestamp, or compared but not signed,
 *  - zero-deadline sentinel handling: `deadline == 0` treated as "no expiry" must be documented
 *    (a comment such as "0 means no expiry"); a documented sentinel that the code does not
 *    implement is also reported.
 *
 * Boundary semantics: allowed while `block.timestamp <= deadline` is inclusive (valid at exactly
 * the deadline); allowed while `block.timestamp < deadline` is exclusive (expired at exactly it).
 *
 * Supported: Solidity 0.8.x source text, single file.
 */
import {
  DetectorFinding,
  DetectorResult,
  Diagnostic,
  Guard,
  buildResult,
  collectGuards,
  extractFunctions,
  failedResult,
  mentionsWord,
  splitStatements,
  splitTopLevel,
  validateSource,
} from "../_shared/solidity-source";

export const RULE_ID = "sig-expiry-boundary";

export type Boundary = "inclusive" | "exclusive";
export interface ExpiryOptions {
  expectedBoundary?: Boundary;
}

export const LIMITATIONS = [
  "Only comparisons written directly against block.timestamp (or now) are traced; deadlines checked inside helper functions or libraries are not followed.",
  "A function is treated as signature-verifying when it calls ecrecover/ECDSA/isValidSignature/SignatureChecker, is named permit, or takes a signature parameter.",
  "Deadline operands are recognised by name (deadline, expir*, validUntil, validBefore, validTo, until).",
  "Sentinel documentation is detected from comments matching phrases such as \"0 means no expiry\".",
];

const SUGGESTION =
  "Pick one boundary convention for every signature deadline (EIP-2612 style `block.timestamp <= deadline` is inclusive), compare against block.timestamp directly, and include the deadline in the signed digest.";

const DEADLINE_RE = /(deadline|expir\w*|validUntil|validBefore|validTo|until)/i;
const SIG_FN_RE = /\becrecover\s*\(|\bECDSA\.|\brecover\s*\(|isValidSignature|SignatureChecker|_hashTypedDataV4|\bsignature\b/;
const HASH_RE = /\bkeccak256\s*\(|abi\.encode|_hashTypedDataV4|hashStruct/;
const TS_RE = /\bblock\.timestamp\b|\bnow\b/;

type Rel = "<" | "<=" | ">" | ">=";
const NEGATE: Record<Rel, Rel> = { "<": ">=", "<=": ">", ">": "<=", ">=": "<" };
const FLIP: Record<Rel, Rel> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };

interface Atom {
  rel: Rel; // relation of block.timestamp to the deadline, as written
  deadline: string;
  adjust?: string;
}

function topLevelAtoms(cond: string): string[] {
  const out: string[] = [];
  for (const part of splitTopLevel(cond.replace(/&&|\|\|/g, "\u0000"), "\u0000")) out.push(part.trim().replace(/^\(+|\)+$/g, "").trim());
  return out;
}

function timeAtom(atom: string): Atom | null {
  const m = /^(.*?)(<=|>=|<|>)(.*)$/.exec(atom);
  if (!m) return null;
  const left = m[1].trim();
  const right = m[3].trim();
  const op = m[2] as Rel;
  const leftTs = TS_RE.test(left);
  const rightTs = TS_RE.test(right);
  if (leftTs === rightTs) return null;
  const deadline = leftTs ? right : left;
  if (!DEADLINE_RE.test(deadline) || TS_RE.test(deadline)) return null;
  const adj = /([+-])\s*(\d+)\s*$/.exec(deadline);
  return { rel: leftTs ? op : FLIP[op], deadline: deadline.replace(/\s*[+-]\s*\d+\s*$/, "").trim(), adjust: adj ? `${adj[1]}${adj[2]}` : undefined };
}

interface Check {
  fn: string;
  line: number;
  style: "inclusive" | "exclusive" | "inverted";
  rel: Rel;
  adjust?: string;
  deadline: string;
}

function allowedStyle(rel: Rel): Check["style"] {
  return rel === "<=" ? "inclusive" : rel === "<" ? "exclusive" : "inverted";
}

export function detectSignatureExpiryBoundary(code: string, options: ExpiryOptions = {}): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const original = typeof code === "string" ? code : "";
  const diagnostics: Diagnostic[] = [...v.diagnostics];
  let expected = options.expectedBoundary;
  const directive = /deadline-boundary:\s*(inclusive|exclusive)/i.exec(original);
  if (!expected && directive) expected = directive[1].toLowerCase() as Boundary;
  const sentinelDocumented = /(?:\b0\b|zero)[^\n]{0,60}(?:no expiry|never expires?|no deadline|does not expire|disables? (?:the )?(?:expiry|deadline)|means no)/i.test(original);

  const findings: DetectorFinding[] = [];
  const checks: Check[] = [];
  const add = (line: number, fn: string, severity: DetectorFinding["severity"], title: string, message: string, evidence: string[], rationale: string, remediation: string) =>
    findings.push({ ruleId: RULE_ID, severity, confidence: severity === "low" ? "medium" : "high", title, message, line, endLine: line, functionName: fn, evidence, rationale, remediation });

  for (const fn of extractFunctions(v.clean)) {
    const isSigFn = fn.kind === "function" && (SIG_FN_RE.test(fn.body) || /permit/i.test(fn.name) || fn.params.some((p) => /^(signature|sig)$/i.test(p.name) || /^(v|r|s)$/.test(p.name)));
    if (!isSigFn) continue;
    const statements = splitStatements(fn, v.clean);
    const guards: Guard[] = collectGuards(statements);

    const deadlineNames = new Set<string>();
    for (const p of fn.params) if (p.name && DEADLINE_RE.test(p.name)) deadlineNames.add(p.name);
    for (const m of fn.body.matchAll(/\b([A-Za-z_$][\w$]*\.(?:deadline|expir\w*|validUntil|validBefore|validTo))\b/g)) deadlineNames.add(m[1]);

    let sawTimeCheck = false;
    let sentinelInCode = false;
    const considered: Array<{ cond: string; form: Guard["form"] | "expr"; line: number }> = guards.map((g) => ({ cond: g.condition, form: g.form, line: g.line }));
    for (const s of statements) if (/^return\b/.test(s.text) && TS_RE.test(s.text)) considered.push({ cond: s.text.replace(/^return\s+/, ""), form: "expr", line: s.line });

    for (const c of considered) {
      if (/(deadline|expir\w*)\w*\s*(?:==|!=)\s*0\b|\b0\s*(?:==|!=)\s*\w*(?:deadline|expir)/i.test(c.cond)) sentinelInCode = true;
      for (const atomText of topLevelAtoms(c.cond)) {
        const atom = timeAtom(atomText);
        if (!atom) continue;
        sawTimeCheck = true;
        const allowed = c.form === "revert-if" || c.form === "return-if" ? NEGATE[atom.rel] : atom.rel;
        const style = allowedStyle(allowed);
        checks.push({ fn: fn.name, line: c.line, style, rel: allowed, adjust: atom.adjust, deadline: atom.deadline });
        if (style === "inverted") {
          add(c.line, fn.name, "high", "Signature expiry check is inverted",
            `${fn.name}() accepts the signature only when block.timestamp ${allowed} ${atom.deadline}: it is valid after the deadline and rejected before it.`,
            [c.cond, `allowed relation: block.timestamp ${allowed} ${atom.deadline}`],
            "An inverted comparison lets expired signatures through and blocks valid ones.", "Allow the signature while block.timestamp <= deadline (or < deadline) and revert otherwise.");
        }
        if (atom.adjust) {
          add(c.line, fn.name, "medium", "Signature deadline adjusted by a constant",
            `${fn.name}() compares block.timestamp with ${atom.deadline} ${atom.adjust}: the effective boundary is shifted by ${atom.adjust.replace(/^[+-]/, "")} second(s) from the signed deadline.`,
            [c.cond], "An off-by-one shifts the exact expiry second away from the value the signer approved.", "Compare against the signed deadline unchanged and choose `<` or `<=` deliberately.");
        }
      }
    }

    // Is a deadline part of the signed digest, and is it checked?
    const digest = statements.find((s) => HASH_RE.test(s.text) && [...deadlineNames].some((d) => mentionsWord(s.text, d)));
    const hasDigest = statements.some((s) => HASH_RE.test(s.text));
    if (deadlineNames.size > 0 && digest && !sawTimeCheck) {
      add(digest.line, fn.name, "high", "Signed deadline is never validated",
        `${fn.name}() signs ${[...deadlineNames].join(", ")} but never compares it with block.timestamp, so expired signatures stay valid.`,
        [digest.text], "The deadline is part of the signed data but no branch enforces it.", "Add require(block.timestamp <= deadline) before using the signature.");
    } else if (deadlineNames.size > 0 && hasDigest && !digest && sawTimeCheck) {
      const first = checks.filter((c) => c.fn === fn.name)[0];
      if (first) {
        add(first.line, fn.name, "medium", "Checked deadline is not part of the signed digest",
          `${fn.name}() checks ${[...deadlineNames].join(", ")} against block.timestamp, but the value is not hashed into the signed digest, so a relayer can change it.`,
          [`deadline: ${[...deadlineNames].join(", ")}`], "An unsigned deadline can be replaced by whoever submits the signature.", "Include the deadline in the typed data that is signed.");
      }
    }

    // Zero-deadline sentinel.
    if (sentinelInCode && !sentinelDocumented) {
      const line = considered.find((c) => /==\s*0|!=\s*0/.test(c.cond))?.line ?? fn.startLine;
      add(line, fn.name, "low", "Zero deadline sentinel is undocumented",
        `${fn.name}() treats a zero deadline as a special case but nothing documents that 0 means no expiry.`, [`sentinel check on ${[...deadlineNames].join(", ") || "deadline"}`],
        "Callers cannot tell whether 0 means never expires or already expired.", "Document the sentinel (for example \"0 means no expiry\") or remove it.");
    } else if (!sentinelInCode && sentinelDocumented && sawTimeCheck) {
      add(fn.startLine, fn.name, "medium", "Documented zero deadline sentinel is not implemented",
        `The source documents that a zero deadline means no expiry, but ${fn.name}() has no zero check, so deadline 0 is always expired.`, [`checked deadline: ${[...deadlineNames].join(", ")}`],
        "Documentation and behavior disagree at the boundary value 0.", "Handle deadline == 0 explicitly or fix the documentation.");
    }
  }

  // Consistency across functions.
  const real = checks.filter((c) => c.style !== "inverted");
  const inclusive = real.filter((c) => c.style === "inclusive");
  const exclusive = real.filter((c) => c.style === "exclusive");
  const dominant: Boundary | undefined = expected ?? (inclusive.length > 0 && exclusive.length > 0 ? (inclusive.length >= exclusive.length ? "inclusive" : "exclusive") : undefined);
  if (dominant) {
    for (const c of real) {
      if (c.style === dominant) continue;
      add(c.line, c.fn, "medium", expected ? "Expiry boundary differs from the expected convention" : "Inconsistent expiry boundary across functions",
        `${c.fn}() treats the deadline as ${c.style} (block.timestamp ${c.rel} ${c.deadline}) while ${expected ? "the expected convention is" : "most checks in this file are"} ${dominant}: a signature is ${c.style === "exclusive" ? "already expired" : "still valid"} at exactly the deadline.`,
        [`${c.style}: block.timestamp ${c.rel} ${c.deadline}`, `expected: ${dominant}`],
        "Different functions disagree about the exact expiry second, so the same signature behaves differently depending on where it is used.",
        `Use ${dominant === "inclusive" ? "block.timestamp <= deadline" : "block.timestamp < deadline"} consistently.`);
    }
  }
  return buildResult(RULE_ID, findings, diagnostics, LIMITATIONS, SUGGESTION);
}
