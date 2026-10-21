import * as fs from "fs";
import * as path from "path";
import { maskSource } from "./cross-file-resolver";
import {
  PARSER_FALLBACK_SCHEMA_VERSION,
  TransientParserError,
  createLexicalOutlineStrategy,
  detectLanguage,
  parseWithFallback,
  type ParserSource,
  type ParserStrategy,
} from "./ast-parser-fallback";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/ast-parser-fallback");

function loadRepo(name: string): ParserSource[] {
  const root = path.join(FIXTURES, name);
  const out: ParserSource[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        out.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          content: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(root);
  return out;
}

const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), "utf8");

const LANGS = ["solidity", "rust", "vyper"];

/** Rejects the `transient` keyword (new syntax) and unbalanced braces, like a strict real parser. */
const strict: ParserStrategy<{ kind: string }> = {
  name: "strict",
  languages: LANGS,
  parse(source, ctx) {
    if (/\btransient\b/.test(source)) throw new SyntaxError("unexpected keyword 'transient'");
    const masked = maskSource(source, ctx.language as "solidity");
    const opens = (masked.match(/{/g) ?? []).length;
    const closes = (masked.match(/}/g) ?? []).length;
    if (opens !== closes) throw new SyntaxError("unbalanced braces");
    return { ast: { kind: "full" } };
  },
};

/** Keeps going past errors and returns a partial tree. */
const recovering: ParserStrategy<{ kind: string }> = {
  name: "recovering",
  languages: LANGS,
  parse() {
    return {
      ast: { kind: "recovered" },
      complete: false,
      diagnostics: [{ code: "recovered_error", message: "skipped a bad declaration", line: 4 }],
    };
  },
};

const lexical = createLexicalOutlineStrategy() as ParserStrategy<any>;
const chain: Array<ParserStrategy<any>> = [strict, recovering, lexical];

const byPath = (res: { files: any[] }, p: string) => res.files.find((f) => f.path === p)!;

describe("realistic mixed repository", () => {
  let result: Awaited<ReturnType<typeof parseWithFallback>>;
  beforeAll(async () => {
    result = await parseWithFallback(loadRepo("realistic-repo"), chain);
  });

  it("parses valid files with the first strategy and marks them parsed", () => {
    for (const p of ["contracts/Token.sol", "contracts/Vault.sol", "src/lib.rs", "vault.vy"]) {
      expect(byPath(result, p)).toMatchObject({
        status: "parsed",
        strategy: "strict",
        fallbackUsed: false,
        complete: true,
      });
    }
  });

  it("falls back to the recovering parser for syntax the strict parser rejects", () => {
    const future = byPath(result, "contracts/Future.sol");
    expect(future).toMatchObject({
      status: "degraded",
      strategy: "recovering",
      fallbackUsed: true,
      complete: false,
    });
    expect(future.attempts.map((a: any) => [a.strategy, a.outcome])).toEqual([
      ["strict", "error"],
      ["recovering", "partial"],
      ["lexical-outline", "partial"],
    ]);
    expect(future.attempts[0].message).toContain("unexpected keyword 'transient'");
    expect(future.diagnostics).toEqual([
      { code: "recovered_error", message: "skipped a bad declaration", line: 4 },
    ]);
  });

  it("reports files with no parser as unsupported rather than empty", () => {
    expect(byPath(result, "NOTES.md")).toMatchObject({ status: "unsupported", attempts: [] });
    expect(byPath(result, "NOTES.md").ast).toBeUndefined();
  });

  it("summarizes the run", () => {
    expect(result.schemaVersion).toBe(PARSER_FALLBACK_SCHEMA_VERSION);
    expect(result.summary).toEqual({
      files: 7,
      parsed: 4,
      degraded: 2,
      failed: 0,
      unsupported: 1,
      skipped: 0,
      fallbackUsed: 2,
      timedOut: 0,
      byStrategy: { recovering: 2, strict: 4 },
    });
    expect(result.files.map((f) => f.path)).toEqual([...result.files.map((f) => f.path)].sort());
  });

  it("uses a configured strategy order and can fall through to the outline", async () => {
    const res = await parseWithFallback(loadRepo("realistic-repo"), chain, {
      strategyOrder: { solidity: ["strict", "lexical-outline"] },
    });
    const broken = byPath(res, "contracts/Broken.sol");
    expect(broken).toMatchObject({ status: "degraded", strategy: "lexical-outline", complete: false });
    expect(broken.ast.nodes.map((n: any) => [n.kind, n.name, n.startLine, n.endLine])).toEqual([
      ["contract", "Half", 3, 7],
      ["function", "a", 4, 7],
    ]);
    expect(broken.diagnostics.map((d: any) => d.code)).toEqual(["lexical_outline", "unterminated_block"]);
  });

  it("is deterministic regardless of input order", async () => {
    const sources = loadRepo("realistic-repo");
    const a = await parseWithFallback(sources, chain);
    const b = await parseWithFallback([...sources].reverse(), chain);
    expect(JSON.stringify({ ...b, telemetry: 0 })).toBe(JSON.stringify({ ...a, telemetry: 0 }));
  });
});

describe("lexical outline strategy", () => {
  const outline = (rel: string, language: string) =>
    (lexical.parse(read(rel), { path: rel, language }) as any).ast.nodes.map((n: any) => [
      n.kind,
      n.name,
      n.startLine,
      n.endLine,
      n.depth,
    ]);

  it("lists declarations and members with line ranges", () => {
    expect(outline("realistic-repo/contracts/Token.sol", "solidity")).toEqual([
      ["interface", "IToken", 4, 6, 0],
      ["function", "transfer", 5, 5, 1],
      ["contract", "Token", 8, 19, 0],
      ["event", "Moved", 11, 11, 1],
      ["function", "transfer", 13, 18, 1],
    ]);
  });

  it("reports itself as a partial tree", () => {
    const out = lexical.parse(read("realistic-repo/contracts/Token.sol"), {
      path: "Token.sol",
      language: "solidity",
    }) as any;
    expect(out.complete).toBe(false);
    expect(out.diagnostics!.map((d) => d.code)).toEqual(["lexical_outline"]);
  });

  it("regression: ignores braces inside strings and comments", () => {
    expect(outline("regression/braces-in-strings.sol", "solidity")).toEqual([
      ["contract", "Messages", 4, 12, 0],
      ["function", "say", 9, 11, 1],
    ]);
  });

  it("regression: semicolons inside Rust array types do not end a declaration", () => {
    expect(outline("regression/array-types.rs", "rust")).toEqual([
      ["struct", "Buffer", 1, 3, 0],
      ["fn", "new", 6, 8, 1],
      ["fn", "as_array", 10, 12, 1],
      ["const", "LIMIT", 15, 15, 0],
    ]);
  });

  it("regression: ends Vyper blocks at the next unindented line", () => {
    expect(outline("regression/indented.vy", "vyper")).toEqual([
      ["struct", "Position", 5, 7, 0],
      ["def", "deposit", 10, 12, 0],
      ["def", "withdraw", 16, 17, 0],
    ]);
  });
});

describe("failure semantics", () => {
  const source = (content = "contract A {}"): ParserSource[] => [{ path: "a.sol", content }];
  const fixed = (name: string, impl: ParserStrategy["parse"]): ParserStrategy => ({
    name,
    languages: ["solidity"],
    parse: impl,
  });

  it("marks files failed when every strategy fails", async () => {
    const res = await parseWithFallback(source(), [
      fixed("one", () => { throw new Error("boom"); }),
      fixed("two", () => ({} as any)),
    ]);
    expect(res.files[0]).toMatchObject({ status: "failed", reason: "Every parser strategy failed." });
    expect(res.files[0]!.attempts.map((a) => a.outcome)).toEqual(["error", "invalid-output"]);
  });

  it("fails partial-only files when requireComplete is set", async () => {
    const res = await parseWithFallback(source(), [recovering as any], { requireComplete: true });
    expect(res.files[0]).toMatchObject({ status: "failed" });
    expect(res.files[0]!.ast).toBeUndefined();
  });

  it("moves on after a timeout and records it", async () => {
    const res = await parseWithFallback(
      source(),
      [
        fixed("slow", () => new Promise(() => undefined) as any),
        fixed("fast", () => ({ ast: "ok" })),
      ],
      { timeoutMs: 20 },
    );
    expect(res.files[0]).toMatchObject({ status: "degraded", strategy: "fast", fallbackUsed: true });
    expect(res.files[0]!.attempts[0]).toMatchObject({ strategy: "slow", outcome: "timeout" });
    expect(res.summary.timedOut).toBe(1);
  });

  it("retries transient errors only, up to maxAttemptsPerStrategy", async () => {
    let transientCalls = 0;
    let permanentCalls = 0;
    const res = await parseWithFallback(
      source(),
      [
        fixed("flaky", () => {
          transientCalls++;
          if (transientCalls < 3) throw new TransientParserError("worker busy");
          return { ast: "ok" };
        }),
      ],
      { maxAttemptsPerStrategy: 3 },
    );
    expect(res.files[0]).toMatchObject({ status: "parsed", strategy: "flaky" });
    expect(res.files[0]!.attempts.map((a) => a.outcome)).toEqual(["transient-error", "transient-error", "complete"]);

    await parseWithFallback(source(), [
      fixed("broken", () => {
        permanentCalls++;
        throw new Error("syntax");
      }),
    ]);
    expect(permanentCalls).toBe(1);
  });

  it("skips strategies by file size so large files reach the outline", async () => {
    const big = "contract A {}\n" + "// padding\n".repeat(50);
    const limited: ParserStrategy = { ...fixed("small-only", () => ({ ast: 1 })), maxBytes: 100 };
    const res = await parseWithFallback(source(big), [limited, lexical]);
    expect(res.files[0]).toMatchObject({ status: "degraded", strategy: "lexical-outline" });
    expect(res.files[0]!.attempts[0]).toMatchObject({ strategy: "small-only", outcome: "skipped-size" });
  });

  it("skips files above maxFileBytes without invoking any strategy", async () => {
    const parse = jest.fn(() => ({ ast: 1 }));
    const res = await parseWithFallback(source("x".repeat(50)), [fixed("s", parse)], { maxFileBytes: 10 });
    expect(res.files[0]).toMatchObject({ status: "skipped", attempts: [] });
    expect(parse).not.toHaveBeenCalled();
  });

  it("does not leak long error text and bounds diagnostics", async () => {
    const res = await parseWithFallback(
      source(),
      [
        fixed("noisy", () => { throw new Error("secret line\n" + "x".repeat(1000)); }),
        fixed("many", () => ({
          ast: 1,
          diagnostics: Array.from({ length: 10 }, (_, i) => ({ code: "d", message: "m", line: i + 1 })),
        })),
      ],
      { maxDiagnosticsPerFile: 3 },
    );
    const file = res.files[0]!;
    expect(file.attempts[0]!.message).toBe("Error: secret line");
    expect(file.diagnostics).toHaveLength(3);
  });

  it("reports configuration problems and keeps working", async () => {
    const res = await parseWithFallback(
      [
        { path: "../escape.sol", content: "x" },
        { path: "a.sol", content: "x" },
        { path: "a.sol", content: "y" },
      ],
      [lexical, lexical],
      { timeoutMs: -1, strategyOrder: { solidity: ["nope"] } },
    );
    expect(res.issues.map((i) => i.code).sort()).toEqual([
      "DUPLICATE_PATH",
      "DUPLICATE_STRATEGY",
      "INVALID_CONFIG",
      "INVALID_PATH",
      "UNKNOWN_STRATEGY",
    ]);
    // Unknown names were dropped, leaving an empty override: nothing supports the file.
    expect(res.files).toHaveLength(1);
    expect(res.files[0]!.status).toBe("unsupported");
  });

  it("honours disabledStrategies and explicit languages", async () => {
    const res = await parseWithFallback(
      [{ path: "contract.txt", content: "contract A {}", language: "solidity" }],
      [strict as ParserStrategy, lexical],
      { disabledStrategies: ["strict"] },
    );
    expect(res.files[0]).toMatchObject({ language: "solidity", strategy: "lexical-outline", status: "degraded" });
  });

  it("returns an empty result for empty input", async () => {
    const res = await parseWithFallback([], chain);
    expect(res.files).toEqual([]);
    expect(res.summary.files).toBe(0);
  });
});

describe("detectLanguage", () => {
  it("maps extensions case-insensitively and rejects unknown ones", () => {
    expect(detectLanguage("a/B.SOL")).toBe("solidity");
    expect(detectLanguage("x.vyi")).toBe("vyper");
    expect(detectLanguage("README.md")).toBeUndefined();
    expect(detectLanguage(".sol")).toBeUndefined();
  });
});
