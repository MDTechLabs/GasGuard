import {
  extractCallables,
  findMatchingClose,
  FunctionModel,
  lineAndColumn,
  prepareSoliditySource,
  splitTopLevelArguments,
} from "./solidity-source-utils";

export type ZeroAddressEntryPoint = "constructor" | "initializer" | "setter" | "factory";
export type ZeroAddressCategory = "upgrade" | "authorization" | "custody" | "pricing";

export interface ZeroAddressFinding {
  entryPoint: ZeroAddressEntryPoint;
  category: ZeroAddressCategory;
  functionName: string;
  parameter: string;
  line: number;
  startColumn: number;
  endColumn: number;
  /** The statement that stores or forwards the unvalidated address. */
  sink: string;
  confidence: number;
  /** Whether the entry point is restricted by an access-control modifier. */
  restricted: boolean;
  evidence: string[];
  impact: string;
}

export interface ZeroAddressDetection {
  findings: ZeroAddressFinding[];
  diagnostics: string[];
}

/** Checked in priority order: upgrade and authorization addresses outrank custody and pricing. */
const CATEGORY_PATTERNS: Array<[ZeroAddressCategory, RegExp]> = [
  ["upgrade", /implementation|\bimpl(?![a-z])|logic|beacon|upgrade|mastercopy|singleton|template/i],
  [
    "authorization",
    /owner|admin|governor|governance|guardian|operator|manager|minter|pauser|authority|controller|keeper|multisig|timelock|signer|verifier|\brole\b/i,
  ],
  [
    "custody",
    /token|asset|underlying|vault|treasury|recipient|receiver|beneficiary|reserve|escrow|collateral|payee|wallet|feeto|feerecipient|custod/i,
  ],
  ["pricing", /oracle|pricefeed|feed|aggregator|pricer|twap/i],
];

const IMPACT: Record<ZeroAddressCategory, string> = {
  upgrade:
    "A zero implementation or beacon leaves a proxy delegating to empty code, where calls succeed without effect or revert, and an upgrade to zero may be irreversible.",
  authorization:
    "A zero owner, admin, or role holder permanently locks every function that depends on that privilege; if ownership cannot be reassigned the contract cannot be recovered or upgraded.",
  custody:
    "A zero token makes high-level token calls revert (bricking deposits and withdrawals) or low-level calls succeed silently; a zero treasury or recipient burns the funds sent to it.",
  pricing:
    "A zero oracle or price feed makes every price read revert, halting borrowing, liquidation, and swaps, or returns empty data that is read as a price of zero.",
};

/** Sinks provided by widely used base contracts that do not reject address(0) themselves. */
const EXTERNAL_SINKS = /^(?:_transferOwnership|_grantRole|_setupRole)$/;
const ZERO_HELPER_NAME = /zero|nonzero|notzero|validaddress|checkaddress|validateaddress|nonnull/i;
const ACCESS_CONTROL = /\b(?:onlyOwner|onlyRole|onlyAdmin|onlyGovernance|onlyGovernor|onlyOperator|auth|requiresAuth|onlyGuardian|onlyManager)\b/;
const ADDRESS_LIKE = /^(?:address(?:\s+payable)?|I[A-Z][\w$]*|[A-Za-z_$][\w$]*(?:Interface|Oracle|Token))$/;
const LOCAL_TYPE = /^(?:address|bool|bytes\d*|string|u?int\d*|[A-Z][\w$]*)$/;

const escape = (name: string) => name.replace(/\$/g, "\\$");

function categorize(name: string): ZeroAddressCategory | undefined {
  return CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0];
}

function stripWrappers(expression: string): string {
  let current = expression.trim();
  for (;;) {
    const wrapped = /^(?:payable|address|[A-Za-z_$][\w$]*)\s*\(\s*([^()]*)\s*\)$/.exec(current);
    if (!wrapped) return current;
    current = wrapped[1].trim();
  }
}

export function detectMissingZeroAddressChecks(input: unknown): ZeroAddressDetection {
  const prepared = prepareSoliditySource(input, "Zero-address configuration");
  if (!prepared.ok) return { findings: [], diagnostics: [prepared.diagnostic] };

  const source = input as string;
  const { code } = prepared;
  const callables = extractCallables(code);
  const findings: ZeroAddressFinding[] = [];

  const contracts = [...code.matchAll(/\bcontract\s+([A-Za-z_$][\w$]*)[^{]*\{/g)].map((m) => {
    const open = m.index! + m[0].length - 1;
    return { name: m[1], start: open, end: findMatchingClose(code, open, "{", "}") };
  });
  const contractTypes = new Set(contracts.map((c) => c.name));
  const isAddressLike = (type: string) =>
    ADDRESS_LIKE.test(type) || contractTypes.has(type);

  const bodyOf = (fn: FunctionModel) => code.slice(fn.bodyStart + 1, fn.bodyEnd);
  const enclosingContract = (offset: number) =>
    contracts.find((c) => offset > c.start && offset < c.end);

  const zeroComparison = (body: string, name: string) =>
    new RegExp(
      String.raw`\b${escape(name)}\b\s*(?:!=|==)\s*(?:address\s*\(\s*0\s*\)|0x0+\b|0\b)|(?:address\s*\(\s*0\s*\)|0x0+\b)\s*(?:!=|==)\s*\b${escape(name)}\b`,
    ).test(body) ||
    new RegExp(
      String.raw`\bisContract\s*\(\s*${escape(name)}\s*\)|\b${escape(name)}\s*\.\s*code\s*\.\s*length|\bextcodesize\s*\(\s*${escape(name)}\s*\)`,
    ).test(body);

  /** Whether `fn` validates its own parameter `name` (comparison, modifier, or validating helper). */
  const validates = (fn: FunctionModel, name: string, depth = 0): boolean => {
    if (fn.bodyStart < 0) return false;
    const body = bodyOf(fn);
    if (zeroComparison(body, name)) return true;

    const inspectInvocation = (callee: string, args: string[]): boolean => {
      const index = args.findIndex((arg) => stripWrappers(arg) === name);
      if (index < 0) return false;
      const local = callables.find(
        (c) => c.name === callee && c.kind !== "constructor" && c.bodyStart >= 0,
      );
      if (local) {
        const param = local.params[index]?.name;
        return depth < 3 && param !== undefined && validates(local, param, depth + 1);
      }
      return ZERO_HELPER_NAME.test(callee);
    };

    // Modifiers in the header and helper calls in the body.
    const afterParams = fn.header.slice(fn.header.indexOf(")") + 1);
    const invocations = [
      ...[...afterParams.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g)].map(
        (m) => [m[1], m[2].split(",")] as [string, string[]],
      ),
      ...[...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g)].map(
        (m) => [m[1], m[2].split(",")] as [string, string[]],
      ),
    ];
    if (invocations.some(([callee, args]) => inspectInvocation(callee, args))) return true;

    // A parameter forwarded to a base-contract constructor (for example Ownable(owner)) is
    // validated, or not, by code outside this source; do not claim it is missing.
    return fn.kind === "constructor" && new RegExp(String.raw`\b[A-Z][\w$]*\s*\([^()]*\b${escape(name)}\b`).test(afterParams);
  };

  /** True when the comment block directly above a callable documents address(0) as meaningful for `name`. */
  const documentsZeroSentinel = (fn: FunctionModel, name: string): boolean => {
    const boundary = Math.max(
      code.lastIndexOf(";", fn.start),
      code.lastIndexOf("{", fn.start),
      code.lastIndexOf("}", fn.start),
    );
    const comment = source.slice(boundary + 1, fn.start);
    if (!new RegExp(String.raw`\b${escape(name)}\b`).test(comment)) return false;
    return (
      /(?:\bzero\b|address\s*\(\s*0\s*\)|\b0x0+\b)/i.test(comment) &&
      /\b(?:disable\w*|optional\w*|sentinel|unset|none|native|allowed|permitted|may\s+be|can\s+be|means|clears?|removes?|renounce\w*)\b/i.test(comment)
    );
  };

  const push = (
    fn: FunctionModel,
    entryPoint: ZeroAddressEntryPoint,
    category: ZeroAddressCategory,
    parameter: string,
    start: number,
    end: number,
    confidence: number,
    sinkEvidence: string,
  ) => {
    const { line, column } = lineAndColumn(source, start);
    const restricted = fn.kind === "function" && ACCESS_CONTROL.test(fn.header);
    findings.push({
      entryPoint,
      category,
      functionName: fn.name,
      parameter,
      line,
      startColumn: column,
      endColumn: column + (end - start) - 1,
      sink: source.slice(start, end).replace(/\s+/g, " ").trim(),
      confidence: restricted ? Math.max(0.3, confidence - 0.1) : confidence,
      restricted,
      impact: IMPACT[category],
      evidence: [
        sinkEvidence,
        `Parameter '${parameter}' is never compared with address(0) and is not passed through a validating modifier or helper.`,
        restricted
          ? "The entry point is restricted to a privileged role, so the realistic failure is an operator mistake rather than an attacker."
          : "The entry point is not restricted by a recognized access-control modifier.",
      ],
    });
  };

  for (const fn of callables) {
    if (fn.kind === "modifier" || fn.bodyStart < 0 || fn.bodyEnd < 0) continue;
    if (fn.kind === "function" && (/\b(?:internal|private|view|pure)\b/.test(fn.header) || !/\b(?:external|public)\b/.test(fn.header))) {
      continue;
    }

    const body = bodyOf(fn);
    const bodyOffset = fn.bodyStart + 1;
    const entryPoint: ZeroAddressEntryPoint =
      fn.kind === "constructor"
        ? "constructor"
        : /^(?:initialize\w*|init|setup)$|^__\w+_init(?:_unchained)?$/i.test(fn.name) ||
            /\b(?:initializer|reinitializer)\b/.test(fn.header)
          ? "initializer"
          : /^(?:create|deploy|clone|spawn|build|make)/i.test(fn.name) &&
              /\bnew\s+[A-Z]|\bclone\w*\s*\(|\bcreate2?\b|\.initialize\s*\(/.test(body)
            ? "factory"
            : "setter";

    const paramNames = new Set(fn.params.map((p) => p.name));
    const targets = fn.params.filter((p) => p.name && isAddressLike(p.type));
    const localNames = new Set<string>(paramNames);

    const statements: Array<{ text: string; start: number }> = [];
    let cursor = 0;
    for (const raw of body.split(";")) {
      const prefix = /^(?:\s*(?:unchecked\s*)?[{}])*\s*/.exec(raw)![0].length;
      statements.push({ text: raw.slice(prefix).trim(), start: bodyOffset + cursor + prefix });
      cursor += raw.length + 1;
    }

    const reported = new Set<string>();
    for (const target of targets) {
      const name = target.name;
      if (validates(fn, name) || documentsZeroSentinel(fn, name)) continue;
      const word = new RegExp(String.raw`\b${escape(name)}\b`);

      for (const statement of statements) {
        const { text } = statement;
        if (text === "" || !word.test(text)) continue;
        const end = statement.start + text.length;

        const declaration = /^(?:[A-Za-z_$][\w$]*(?:\s+payable)?)\s+(?:memory\s+|storage\s+|calldata\s+)?([A-Za-z_$][\w$]*)\s*=/.exec(text);
        if (declaration && LOCAL_TYPE.test(text.split(/\s+/)[0])) localNames.add(declaration[1]);

        // 1. Direct store: stateVar = param
        const assignment = /^([^=!<>+\-]+?)\s*=(?!=)\s*([^]+)$/.exec(text);
        if (assignment && !declaration && stripWrappers(assignment[2]) === name) {
          const lhs = assignment[1].trim();
          const base = /^[A-Za-z_$][\w$]*/.exec(lhs)?.[0];
          if (base && !localNames.has(base)) {
            const category = categorize(name) ?? categorize(base);
            if (category && !reported.has(`${name}:${statement.start}`)) {
              reported.add(`${name}:${statement.start}`);
              push(fn, entryPoint, category, name, statement.start, end, categorize(name) ? 0.8 : 0.65,
                `'${fn.name}' stores '${name}' in '${lhs}' without validating it.`);
            }
          }
          continue;
        }

        // 2. Forwarded to a sink call, deployment, or initializer.
        const flat = text.replace(/(?<!\bnew\s+)\b(?:payable|address|I?[A-Z][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, "$1");
        for (const call of flat.matchAll(/(new\s+)?((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*)\s*\(([^()]*)\)/g)) {
          const [, isNew, callee, rawArgs] = call;
          const args = splitTopLevelArguments(rawArgs, -1, rawArgs.length).map((a) => rawArgs.slice(a.start, a.end));
          const index = args.findIndex((arg) => stripWrappers(arg) === name);
          if (index < 0) continue;
          const simple = callee.split(".").pop()!.trim();

          let sinkKind: string | undefined;
          let modeled: FunctionModel | undefined;
          if (isNew) {
            sinkKind = `deploys new ${simple}(...) with '${name}'`;
            modeled = callables.find((c) => c.kind === "constructor" && c.bodyStart >= 0 && enclosingContract(c.start)?.name === simple);
          } else if (/^(?:initialize\w*|init|__\w+_init(?:_unchained)?)$/.test(simple)) {
            sinkKind = `forwards '${name}' to ${simple}(...)`;
            const type = new RegExp(String.raw`\b([A-Z][\w$]*)\s*\([^()]*\)\s*\.\s*${simple}\s*\(`).exec(text)?.[1];
            modeled = callables.find((c) => c.name === simple && c.bodyStart >= 0 && type !== undefined && enclosingContract(c.start)?.name === type);
          } else if (EXTERNAL_SINKS.test(simple)) {
            sinkKind = `passes '${name}' to ${simple}(...), which does not reject address(0)`;
          } else {
            const local = callables.find((c) => c.name === simple && c.kind === "function" && c.bodyStart >= 0 && c !== fn);
            if (local) {
              const param = local.params[index]?.name;
              if (param && !validates(local, param)) {
                const stores = bodyOf(local).split(";").some((s) => {
                  const m = /^\s*(?:\{|\})*\s*([^=!<>+\-]+?)\s*=(?!=)\s*([^]+)$/.exec(s);
                  return m !== null && stripWrappers(m[2]) === param && !local.params.some((p) => p.name === m[1].trim());
                });
                if (stores) sinkKind = `passes '${name}' to ${simple}(...), which stores it without validation`;
              }
            }
          }
          if (!sinkKind) continue;

          // A constructor or initializer implemented in this source may validate the argument itself.
          if (modeled) {
            const param = modeled.params[index]?.name;
            if (param && validates(modeled, param)) continue;
          }

          const category = categorize(name) ?? categorize(simple) ?? (isNew ? categorize(simple) : undefined);
          const key = `${name}:${statement.start}`;
          if (category && !reported.has(key)) {
            reported.add(key);
            push(fn, entryPoint, category, name, statement.start, end,
              (categorize(name) ? 0.75 : 0.6) - (modeled ? 0 : 0.05),
              `'${fn.name}' ${sinkKind} without validating it${modeled ? "" : " (the callee's implementation is not available in this source)"}.`);
          }
        }
      }
    }
  }

  findings.sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  return { findings, diagnostics: [] };
}
