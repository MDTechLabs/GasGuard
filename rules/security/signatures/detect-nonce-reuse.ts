/**
 * Nonce reuse across multiple authorization methods (#1376)
 *
 * Builds, for every signature-verifying function (permit, meta-transaction, order fill,
 * administrative action, ...), which nonce stores it reads (validates) and which it writes
 * (consumes), then reports:
 *  - a nonce that is validated but never consumed (the signature can be replayed),
 *  - a nonce consumed only on some paths, or only after an external call (reentrant replay),
 *  - a method that reads a shared nonce store but never consumes it while another method does,
 *  - two methods with independent nonce stores that sign the same field layout with no
 *    distinguishing purpose (a signature for one validates for the other),
 *  - a state-changing signed method with no nonce and no other replay guard.
 * Separate nonce spaces are accepted when the signed payloads carry different purpose markers
 * (distinct *TYPEHASH / PURPOSE constants, string labels, or msg.sig), so intentionally separate
 * spaces (permit nonces versus order nonces) are not reported.
 *
 * Stores are recognised by name (nonce*, used*, executed*, consumed*) and by a helper call such as
 * _useNonce; helpers defined in the same file are followed.
 *
 * Supported: Solidity 0.8.x source text, single file. This rule reports nonce handling only; domain
 * binding is covered by `sig-missing-domain-separation`.
 */
import {
  DetectorFinding,
  DetectorResult,
  Statement,
  buildResult,
  collectLocalTypes,
  extractFunctions,
  failedResult,
  findMatching,
  isExternallyCallable,
  splitStatements,
  splitTopLevel,
  validateSource,
  wordsIn,
} from "../_shared/solidity-source";

export const RULE_ID = "sig-nonce-reuse";

export const LIMITATIONS = [
  "Nonce stores are recognised by name (nonce*, used*, executed*, consumed*) and must not be locals or parameters of the function.",
  "Consumption through helpers is followed only for helpers defined in this file or named like _useNonce/_consumeNonce/_useCheckedNonce.",
  "Purpose separation is judged from typehash/purpose constants, string labels and msg.sig in the signed payload; other schemes (a purpose argument) are not recognised.",
  "Cross-method replay needs the same nonce values to be valid in both stores; the rule reports the identical layout as a risk, not a proven exploit.",
];

const SUGGESTION =
  "Consume the nonce (increment or mark used) before any external call and on every path, use one nonce store per purpose or a shared store consumed by every method, and put a purpose marker (typehash) in each signed payload.";

const STORE_RE = /^_?(?:\w*[nN]once\w*|used\w*|executed\w*|consumed\w*|isUsed\w*)$/;
const HELPER_RE = /\b_?(?:use|consume|incrementNonce|useChecked)\w*Nonce\w*\s*\(|\b_?useNonce\s*\(|\b_?consumeNonce\s*\(|\b_?useCheckedNonce\s*\(/;
const SIG_RE = /\becrecover\s*\(|\bECDSA\.|\.recover\s*\(|\brecover\s*\(|isValidSignature|SignatureChecker|_hashTypedDataV4/;
const EXT_CALL = /\.call\b|\.delegatecall\b|\.transfer\s*\(|\.send\s*\(|\.safeTransfer\w*\s*\(|\.transferFrom\s*\(|\.functionCall\w*\s*\(/;
const OTHER_GUARD = /\b(?:executed|used|consumed|filled|cancelled|canceled|processed|claimed|fulfilled)\w*\s*\[/i;

interface Method {
  name: string;
  line: number;
  reads: Set<string>;
  writes: Set<string>;
  firstWrite: number;
  firstCall: number;
  unconditionalWrite: boolean;
  fields: string[];
  purposes: string[];
  stateChanging: boolean;
  statements: Statement[];
}

function storesIn(text: string, locals: Set<string>): string[] {
  return wordsIn(text).filter((w) => STORE_RE.test(w) && !locals.has(w));
}

export function detectNonceReuse(code: string): DetectorResult {
  const v = validateSource(code);
  if (!v.ok) return failedResult(RULE_ID, v.diagnostics, LIMITATIONS, SUGGESTION);
  const original = typeof code === "string" ? code : "";
  const findings: DetectorFinding[] = [];
  const fns = extractFunctions(v.clean);

  // Helpers defined in this file that consume a nonce store.
  const consumers = new Set<string>();
  for (const fn of fns) {
    const st = splitStatements(fn, v.clean);
    const locals = new Set(collectLocalTypes(fn, st).keys());
    if (st.some((s) => storesIn(s.text, locals).some((n) => new RegExp(`(?:\\+\\+|--)\\s*${n}\\b|\\b${n}\\b(?:\\s*\\[[^\\]]*\\])*\\s*(?:\\+\\+|--|\\+=|=(?!=))`).test(s.text)))) consumers.add(fn.name);
  }

  const methods: Method[] = [];
  for (const fn of fns) {
    if (fn.kind !== "function" || !SIG_RE.test(fn.body)) continue;
    const statements = splitStatements(fn, v.clean);
    const locals = new Set(collectLocalTypes(fn, statements).keys());
    const m: Method = {
      name: fn.name, line: fn.startLine, reads: new Set(), writes: new Set(), firstWrite: -1, firstCall: -1,
      unconditionalWrite: false, fields: [], purposes: [], stateChanging: fn.mutability !== "view" && fn.mutability !== "pure", statements,
    };
    statements.forEach((s, i) => {
      if (s.kind === "close") return;
      const stores = storesIn(s.text, locals);
      let wrote = false;
      for (const n of stores) {
        const write = new RegExp(`(?:\\+\\+|--)\\s*${n}\\b|\\b${n}\\b(?:\\s*\\[[^\\]]*\\])*\\s*(?:\\+\\+|--|\\+=|=(?!=))`).test(s.text);
        if (write) {
          m.writes.add(n);
          wrote = true;
        } else if (/^(?:require|assert|if)\b/.test(s.text)) {
          m.reads.add(n);
        }
      }
      if (!wrote) {
        const called = fns.find((f) => f.name !== fn.name && consumers.has(f.name) && new RegExp(`\\b${f.name}\\s*\\(`).test(s.text));
        if (HELPER_RE.test(s.text) || called) {
          m.writes.add(called ? called.name : "(helper)");
          wrote = true;
        }
      }
      if (wrote) {
        if (m.firstWrite < 0) m.firstWrite = i;
        if (s.blockPath.length === 0) m.unconditionalWrite = true;
      }
      if (m.firstCall < 0 && EXT_CALL.test(s.text)) m.firstCall = i;
      const encode = /\babi\.encode(?:Packed)?\s*\(/.exec(s.text);
      if (encode && /\bkeccak256\s*\(/.test(s.text) && m.fields.length === 0) {
        const open = s.text.indexOf("(", encode.index);
        const close = findMatching(s.text, open, "(", ")");
        const args = splitTopLevel(s.text.slice(open + 1, close < 0 ? undefined : close)).map((a) => a.trim());
        const orig = original.slice(s.start, s.start + s.text.length);
        for (const a of args) {
          if (/(TYPEHASH|TYPE_HASH|PURPOSE|SELECTOR)/.test(a) || /^msg\.sig$/.test(a) || /\.selector$/.test(a)) m.purposes.push(a);
          else if (/^[A-Za-z_$][\w$.]*(?:\[[^\]]*\])*(?:\+\+)?$/.test(a) && !storesIn(a, locals).length && !/nonce/i.test(a)) m.fields.push(a);
        }
        for (const lit of orig.matchAll(/"([^"]+)"/g)) m.purposes.push(`"${lit[1]}"`);
      }
    });
    methods.push(m);
  }

  const add = (m: Method, line: number, severity: DetectorFinding["severity"], title: string, message: string, evidence: string[], rationale: string, remediation: string) =>
    findings.push({ ruleId: RULE_ID, severity, confidence: severity === "high" ? "high" : "medium", title, message, line, endLine: line, functionName: m.name, evidence, rationale, remediation });
  const lineOfStmt = (m: Method, i: number) => (m.statements[i] ? m.statements[i].line : m.line);

  for (const m of methods) {
    const readNames = [...m.reads].join(", ");
    const writeNames = [...m.writes].join(", ");
    const sharedConsumed = methods.some((o) => o !== m && [...o.writes].some((w) => m.reads.has(w)));
    if (m.reads.size > 0 && m.writes.size === 0) {
      add(m, m.line, "high", "Nonce is validated but never consumed",
        `${m.name}() checks ${readNames} but never increments or marks it used${sharedConsumed ? ", although another method consuming the same store shows the intended rule" : ""}: the same signature can be replayed.`,
        [`reads: ${readNames}`, "writes: none"], "A nonce that is only checked does not stop replay; the signed message stays valid forever.", "Increment or mark the nonce used (before any external call) in every path.");
      continue;
    }
    if (m.writes.size > 0) {
      if (m.firstCall >= 0 && m.firstWrite > m.firstCall) {
        add(m, lineOfStmt(m, m.firstWrite), "high", "Nonce is consumed after an external call",
          `${m.name}() consumes ${writeNames} only after an external call, so a reentrant call can replay the signature before the nonce is used.`,
          [`external call at line ${lineOfStmt(m, m.firstCall)}`, `nonce consumed at line ${lineOfStmt(m, m.firstWrite)}`], "State is updated after the interaction (checks-effects-interactions violated).", "Consume the nonce before the external call.");
      } else if (!m.unconditionalWrite && m.reads.size > 0) {
        add(m, lineOfStmt(m, m.firstWrite), "medium", "Nonce is consumed only on some paths",
          `${m.name}() validates ${readNames} on every path but consumes ${writeNames} only inside a conditional block.`,
          [`reads: ${readNames}`, `writes (conditional): ${writeNames}`], "A path that skips the conditional block leaves the nonce unused and the signature replayable.", "Consume the nonce unconditionally before acting on the signature.");
      }
    } else if (m.reads.size === 0 && m.stateChanging && isExternallyCallable(fns.find((f) => f.name === m.name)!) && !OTHER_GUARD.test(m.statements.map((s) => s.text).join(" "))) {
      add(m, m.line, "medium", "Signed method has no nonce or replay guard",
        `${m.name}() verifies a signature and changes state but uses no nonce and no executed/used marker, so the signature can be submitted repeatedly.`,
        ["reads: none", "writes: none"], "Nothing records that the signed message was already used.", "Add a per-signer nonce (consumed on use) or an executed-hash mapping.");
    }
  }

  // Independent nonce stores signing the same layout without a purpose marker.
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      const a = methods[i];
      const b = methods[j];
      if (a.writes.size === 0 || b.writes.size === 0 || a.fields.length === 0) continue;
      const sameStore = [...a.writes].some((w) => b.writes.has(w));
      if (sameStore) continue;
      const sameFields = a.fields.length === b.fields.length && [...a.fields].sort().join("|") === [...b.fields].sort().join("|");
      const distinct = a.purposes.length > 0 && b.purposes.length > 0 && [...a.purposes].sort().join("|") !== [...b.purposes].sort().join("|");
      if (sameFields && !distinct) {
        add(b, b.line, "medium", "Same signed layout under independent nonce stores",
          `${a.name}() and ${b.name}() sign the same fields (${a.fields.join(", ")}) with independent nonce stores (${[...a.writes].join(", ")} vs ${[...b.writes].join(", ")}) and no distinguishing purpose, so a signature for one can validate for the other.`,
          [`${a.name}: ${a.fields.join(", ")}`, `${b.name}: ${b.fields.join(", ")}`, "purpose markers: none distinguishing"], "Without a typehash or label the two methods accept each other's signatures when the nonce values line up.", "Add a distinct typehash (or label) per method to the signed payload, or share one nonce store.");
      }
    }
  }
  return buildResult(RULE_ID, findings, v.diagnostics, LIMITATIONS, SUGGESTION);
}
