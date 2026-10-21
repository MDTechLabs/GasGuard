import * as fs from "fs";
import * as path from "path";
import {
  CROSS_FILE_SCHEMA_VERSION,
  getAffectedFiles,
  getReferencesTo,
  parseRemappings,
  resolveCrossFileReferences,
  type CrossFileSource,
} from "./cross-file-resolver";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/cross-file-resolution");

function loadRepo(name: string): CrossFileSource[] {
  const root = path.join(FIXTURES, name);
  const out: CrossFileSource[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(sol|rs|vy|vyi)$/.test(entry.name)) {
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

function remappingsOf(name: string): Record<string, string> {
  const file = path.join(FIXTURES, name, "remappings.txt");
  return fs.existsSync(file) ? parseRemappings(fs.readFileSync(file, "utf8")) : {};
}

const refsIn = (res: ReturnType<typeof resolveCrossFileReferences>, file: string) =>
  res.references.filter((r) => r.file === file);

describe("parseRemappings", () => {
  it("parses prefix=target lines, ignoring comments, blanks and contexts", () => {
    expect(
      parseRemappings("# c\n\n@a/=lib/a/\nctx:@b/=lib/b/src/\nbroken-line\n=nothing\n"),
    ).toEqual({ "@a/": "lib/a/", "@b/": "lib/b/src/" });
  });
});

describe("realistic Solidity repository", () => {
  const sources = loadRepo("realistic-solidity");
  const res = resolveCrossFileReferences(sources, {
    remappings: remappingsOf("realistic-solidity"),
  });

  it("indexes top-level symbols with kinds and lines", () => {
    expect(res.schemaVersion).toBe(CROSS_FILE_SCHEMA_VERSION);
    const find = (name: string) => res.symbols.find((s) => s.name === name);
    expect(find("IERC20")).toMatchObject({
      kind: "interface",
      file: "contracts/interfaces/IERC20.sol",
      line: 4,
    });
    expect(find("Ownable")).toMatchObject({ kind: "contract", file: "contracts/access/Ownable.sol" });
    expect(find("NotOwner")).toMatchObject({ kind: "error" });
    expect(find("SafeTransfer")).toMatchObject({ kind: "library" });
    // Members nested inside contracts are not file-level symbols.
    expect(find("onlyOwner")).toBeUndefined();
    expect(find("safeTransfer")).toBeUndefined();
  });

  it("resolves remapped, relative, aliased and namespace imports; marks vendored libs external", () => {
    const vault = res.imports.filter((e) => e.from === "contracts/Vault.sol");
    expect(vault.map((e) => [e.specifier, e.status])).toEqual([
      ["@gasguard/access/Ownable.sol", "resolved"],
      ["./interfaces/IERC20.sol", "resolved"],
      ["./libraries/SafeTransfer.sol", "resolved"],
      ["./Errors.sol", "resolved"],
      ["@openzeppelin/security/ReentrancyGuard.sol", "external"],
    ]);
    expect(res.dependencies["contracts/Vault.sol"]).toEqual([
      "contracts/Errors.sol",
      "contracts/access/Ownable.sol",
      "contracts/interfaces/IERC20.sol",
      "contracts/libraries/SafeTransfer.sol",
    ]);
    expect(res.counts.unresolvedImports).toBe(0);
    expect(res.cycles).toEqual([]);
  });

  it("resolves uses to their definitions, honouring aliases and namespaces", () => {
    const vault = refsIn(res, "contracts/Vault.sol");
    const byName = (name: string) => vault.filter((r) => r.name === name);

    expect(byName("Ownable")).toHaveLength(1);
    expect(byName("Ownable")[0]!.target).toMatchObject({ file: "contracts/access/Ownable.sol" });

    // `Token` is an alias of IERC20.
    expect(byName("Token")).toHaveLength(2);
    expect(byName("Token")[0]!.target).toMatchObject({
      name: "IERC20",
      file: "contracts/interfaces/IERC20.sol",
    });

    // Comment and string mentions do not count; only the two real uses do.
    expect(byName("SafeTransfer")).toHaveLength(2);

    expect(byName("ZeroAmount")[0]).toMatchObject({
      via: "Errors",
      status: "resolved",
      target: { file: "contracts/Errors.sol", kind: "error" },
    });

    // Imported from outside the snapshot: reported, but not an error.
    expect(byName("ReentrancyGuard")[0]!.status).toBe("external");
    expect(res.issues.filter((i) => i.code === "UNRESOLVED_SYMBOL")).toEqual([]);
  });

  it("follows imports inside imported files", () => {
    const lib = refsIn(res, "contracts/libraries/SafeTransfer.sol");
    expect(lib).toHaveLength(1);
    expect(lib[0]!.target).toMatchObject({ name: "IERC20", line: 4 });
    expect(getReferencesTo(res, "contracts/interfaces/IERC20.sol", "IERC20")).toHaveLength(2 + 1);
  });

  it("is deterministic regardless of input order", () => {
    const opts = { remappings: remappingsOf("realistic-solidity") };
    const a = resolveCrossFileReferences(sources, opts);
    const b = resolveCrossFileReferences([...sources].reverse(), opts);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("regression: cycles, re-exports, ambiguity and unresolved imports", () => {
  const res = resolveCrossFileReferences(loadRepo("regression"));

  it("reports import cycles once, without looping", () => {
    expect(res.cycles).toEqual([["contracts/a.sol", "contracts/b.sol"]]);
    expect(res.issues.filter((i) => i.code === "IMPORT_CYCLE")).toHaveLength(1);
    expect(refsIn(res, "contracts/a.sol")[0]).toMatchObject({
      name: "B",
      status: "resolved",
      target: { file: "contracts/b.sol" },
    });
    expect(refsIn(res, "contracts/b.sol")[0]).toMatchObject({
      name: "A",
      status: "resolved",
      target: { file: "contracts/a.sol" },
    });
  });

  it("resolves a symbol through a plain-import re-export chain", () => {
    const base = refsIn(res, "contracts/consumer.sol").filter((r) => r.name === "Base");
    // Comment and string mentions are ignored.
    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({
      line: 9,
      status: "resolved",
      target: { file: "contracts/base.sol", line: 3 },
    });
    expect(refsIn(res, "contracts/mid.sol")[0]!.target).toMatchObject({ file: "contracts/base.sol" });
  });

  it("flags a name provided by two plain imports as ambiguous", () => {
    const shared = refsIn(res, "contracts/consumer.sol").filter((r) => r.name === "Shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]!.status).toBe("ambiguous");
    expect(shared[0]!.candidates!.map((c) => c.file)).toEqual([
      "contracts/dupA.sol",
      "contracts/dupB.sol",
    ]);
    expect(res.issues.some((i) => i.code === "AMBIGUOUS_SYMBOL")).toBe(true);
  });

  it("keeps resolving the rest of the repository when a relative import is missing", () => {
    const missing = res.imports.find((e) => e.specifier === "./missing.sol")!;
    expect(missing).toMatchObject({ status: "unresolved", line: 6 });
    expect(res.issues).toContainEqual(
      expect.objectContaining({ code: "UNRESOLVED_IMPORT", file: "contracts/consumer.sol", line: 6 }),
    );
    expect(res.counts.unresolvedImports).toBe(1);
  });
});

describe("Rust crate", () => {
  const res = resolveCrossFileReferences(loadRepo("rust-crate"));

  it("resolves mod declarations and use paths to files", () => {
    expect(res.dependencies["src/lib.rs"]).toEqual(["src/math.rs", "src/storage/mod.rs"]);
    expect(res.dependencies["src/storage/mod.rs"]).toEqual(["src/math.rs"]);
    const std = res.imports.find((e) => e.specifier === "std::collections::HashMap")!;
    expect(std.status).toBe("external");
    expect(res.counts.unresolvedImports).toBe(0);
  });

  it("resolves calls through use, braces with aliases, and module paths", () => {
    const lib = refsIn(res, "src/lib.rs");
    expect(lib.map((r) => [r.name, r.via, r.target?.file, r.target?.line])).toEqual([
      ["add", undefined, "src/math.rs", 1],
      ["sub", "math", "src/math.rs", 5],
    ]);
    const storage = refsIn(res, "src/storage/mod.rs");
    expect(storage.map((r) => [r.name, r.target?.name, r.target?.file])).toEqual([
      ["add", "add", "src/math.rs"],
      ["minus", "sub", "src/math.rs"],
    ]);
  });
});

describe("Vyper", () => {
  const sources: CrossFileSource[] = [
    {
      path: "math.vy",
      content: "def add(a: uint256, b: uint256) -> uint256:\n    return a + b\n\nMAX: constant(uint256) = 100\n",
    },
    {
      path: "main.vy",
      content: [
        "# math.add in a comment does not count",
        "from . import math",
        "from ethereum.ercs import IERC20",
        "",
        "@external",
        "def run(t: IERC20) -> uint256:",
        "    return math.add(1, 2) + math.MAX",
        "",
      ].join("\n"),
    },
  ];
  const res = resolveCrossFileReferences(sources);

  it("resolves module namespaces and flags stdlib imports as external", () => {
    expect(res.dependencies["main.vy"]).toEqual(["math.vy"]);
    expect(refsIn(res, "main.vy").map((r) => [r.name, r.status, r.target?.line])).toEqual([
      ["IERC20", "external", undefined],
      ["add", "resolved", 1],
      ["MAX", "resolved", 4],
    ]);
  });
});

describe("failure semantics", () => {
  it("skips unsupported languages with an issue instead of failing", () => {
    const res = resolveCrossFileReferences([
      { path: "README.md", content: "# hi" },
      { path: "a.sol", content: "contract A {}" },
    ]);
    expect(res.files).toEqual(["a.sol"]);
    expect(res.skippedFiles).toEqual(["README.md"]);
    expect(res.issues.map((i) => i.code)).toEqual(["UNSUPPORTED_LANGUAGE"]);
  });

  it("rejects paths that escape the repository root", () => {
    const res = resolveCrossFileReferences([
      { path: "../outside.sol", content: "contract X {}" },
      { path: "/etc/evil.sol", content: "contract Y {}" },
      { path: "ok.sol", content: "contract Z {}" },
    ]);
    expect(res.files).toEqual(["ok.sol"]);
    expect(res.issues.filter((i) => i.code === "INVALID_PATH")).toHaveLength(2);
  });

  it("does not resolve relative imports above the root", () => {
    const res = resolveCrossFileReferences([
      { path: "a.sol", content: 'import {X} from "../x.sol";\ncontract A is X {}' },
    ]);
    expect(res.imports[0]!.status).toBe("unresolved");
  });

  it("keeps one copy of duplicate paths, independent of input order", () => {
    const one = { path: "a.sol", content: "contract One {}" };
    const two = { path: "a.sol", content: "contract Two {}" };
    const a = resolveCrossFileReferences([one, two]);
    const b = resolveCrossFileReferences([two, one]);
    expect(a.symbols.map((s) => s.name)).toEqual(["One"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.issues.map((i) => i.code)).toEqual(["DUPLICATE_PATH"]);
  });

  it("enforces maxFiles and maxFileBytes", () => {
    const sources = [
      { path: "a.sol", content: "contract A {}" },
      { path: "b.sol", content: "contract B {}" },
      { path: "c.sol", content: "contract C {}" + " ".repeat(100) },
    ];
    const res = resolveCrossFileReferences(sources, { maxFiles: 2, maxFileBytes: 50 });
    expect(res.files).toEqual(["a.sol", "b.sol"]);
    expect(res.issues.map((i) => i.code).sort()).toEqual(["FILE_TOO_LARGE"]);

    const capped = resolveCrossFileReferences(sources.slice(0, 2), { maxFiles: 1 });
    expect(capped.files).toEqual(["a.sol"]);
    expect(capped.issues.map((i) => i.code)).toEqual(["TOO_MANY_FILES"]);
  });

  it("returns an empty resolution for empty input", () => {
    const res = resolveCrossFileReferences([]);
    expect(res.files).toEqual([]);
    expect(res.counts.references).toBe(0);
    expect(res.issues).toEqual([]);
  });
});

describe("getAffectedFiles", () => {
  const res = resolveCrossFileReferences(loadRepo("realistic-solidity"), {
    remappings: remappingsOf("realistic-solidity"),
  });

  it("returns changed files plus transitive importers, sorted", () => {
    expect(getAffectedFiles(res, ["contracts/interfaces/IERC20.sol"])).toEqual([
      "contracts/Vault.sol",
      "contracts/interfaces/IERC20.sol",
      "contracts/libraries/SafeTransfer.sol",
    ]);
  });

  it("ignores invalid paths and leaf files with no importers", () => {
    expect(getAffectedFiles(res, ["../x.sol", "contracts/Vault.sol"])).toEqual([
      "contracts/Vault.sol",
    ]);
  });
});
