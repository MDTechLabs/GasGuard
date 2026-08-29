import fs from "fs";
import os from "os";
import path from "path";
import { SorobanTemplateGenerator, TEMPLATE_REGISTRY } from "../generator";
import { TemplateValidator } from "../validator";
import { TemplateKind } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gasguard-templates-"));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Registry ──────────────────────────────────────────────────────────────────

describe("TEMPLATE_REGISTRY", () => {
  it("contains all four template kinds", () => {
    const kinds: TemplateKind[] = ["token", "counter", "nft", "multisig"];
    for (const kind of kinds) {
      expect(TEMPLATE_REGISTRY[kind]).toBeDefined();
    }
  });

  it("every entry has required metadata fields", () => {
    for (const meta of Object.values(TEMPLATE_REGISTRY)) {
      expect(meta.kind).toBeDefined();
      expect(meta.title).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(Array.isArray(meta.secureDefaults)).toBe(true);
      expect(meta.secureDefaults.length).toBeGreaterThan(0);
      expect(meta.fileName).toMatch(/\.rs$/);
    }
  });
});

// ── Generator: validation ─────────────────────────────────────────────────────

describe("SorobanTemplateGenerator – contract name validation", () => {
  const generator = new SorobanTemplateGenerator();

  it.each([
    ["", "empty string"],
    ["   ", "whitespace only"],
    ["myToken", "starts with lowercase"],
    ["My Token", "contains space"],
    ["My-Token", "contains hyphen"],
    ["123Token", "starts with digit"],
    ["A".repeat(65), "exceeds 64 characters"],
  ])('rejects "%s" (%s)', (name) => {
    expect(() => generator.preview("token", name)).toThrow();
  });

  it.each([
    ["MyToken", "standard PascalCase"],
    ["Token", "single word PascalCase"],
    ["MyNFTContract", "acronym in middle"],
    ["A", "single uppercase letter"],
  ])('accepts "%s" (%s)', (name) => {
    expect(() => generator.preview("token", name)).not.toThrow();
  });
});

// ── Generator: preview ────────────────────────────────────────────────────────

describe("SorobanTemplateGenerator.preview()", () => {
  const generator = new SorobanTemplateGenerator();

  it.each<TemplateKind>(["token", "counter", "nft", "multisig"])(
    "renders %s template without placeholders",
    (kind) => {
      const source = generator.preview(kind, "MyContract");
      expect(source).not.toContain("{{CONTRACT_NAME}}");
      expect(source).toContain("MyContract");
    },
  );

  it("throws for an unknown template kind", () => {
    expect(() =>
      generator.preview("unknown" as TemplateKind, "MyContract"),
    ).toThrow(/Unknown template kind/);
  });
});

// ── Generator: file writing ───────────────────────────────────────────────────

describe("SorobanTemplateGenerator.generate()", () => {
  let tmpDir: string;
  const generator = new SorobanTemplateGenerator();

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it.each<TemplateKind>(["token", "counter", "nft", "multisig"])(
    "generates a %s contract file",
    (kind) => {
      const result = generator.generate({
        kind,
        contractName: "MyContract",
        outputDir: tmpDir,
      });

      expect(fs.existsSync(result.filePath)).toBe(true);
      expect(result.kind).toBe(kind);
      expect(result.contractName).toBe("MyContract");

      const content = fs.readFileSync(result.filePath, "utf-8");
      expect(content).toContain("MyContract");
      expect(content).not.toContain("{{CONTRACT_NAME}}");
    },
  );

  it("names the output file using snake_case", () => {
    const result = generator.generate({
      kind: "token",
      contractName: "MyFancyToken",
      outputDir: tmpDir,
    });
    expect(path.basename(result.filePath)).toBe("my_fancy_token.rs");
  });

  it("throws when file already exists and overwrite is false", () => {
    generator.generate({
      kind: "token",
      contractName: "MyToken",
      outputDir: tmpDir,
    });
    expect(() =>
      generator.generate({
        kind: "token",
        contractName: "MyToken",
        outputDir: tmpDir,
      }),
    ).toThrow(/already exists/);
  });

  it("overwrites an existing file when overwrite is true", () => {
    generator.generate({
      kind: "token",
      contractName: "MyToken",
      outputDir: tmpDir,
    });
    expect(() =>
      generator.generate({
        kind: "token",
        contractName: "MyToken",
        outputDir: tmpDir,
        overwrite: true,
      }),
    ).not.toThrow();
  });

  it("creates the output directory when it does not exist", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    const result = generator.generate({
      kind: "counter",
      contractName: "MyCounter",
      outputDir: nested,
    });
    expect(fs.existsSync(result.filePath)).toBe(true);
  });
});

// ── Validator ─────────────────────────────────────────────────────────────────

describe("TemplateValidator", () => {
  const generator = new SorobanTemplateGenerator();
  const validator = new TemplateValidator();

  it.each<TemplateKind>(["token", "counter", "nft", "multisig"])(
    "rendered %s template passes validation with no errors",
    (kind) => {
      const source = generator.preview(kind, "ValidContract");
      const result = validator.validate(source);

      const errors = result.issues.filter((i) => i.severity === "error");
      expect(errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    },
  );

  it("flags unresolved placeholder as an error", () => {
    const source = `
#![no_std]
use soroban_sdk::{contract, contractimpl};
#[contract]
pub struct {{CONTRACT_NAME}};
#[contractimpl]
impl {{CONTRACT_NAME}} {
  pub fn foo(env: soroban_sdk::Env, caller: soroban_sdk::Address) {
    caller.require_auth();
  }
}
`;
    const result = validator.validate(source);
    const issue = result.issues.find(
      (i) => i.code === "UNRESOLVED_PLACEHOLDER",
    );
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  it("flags missing require_auth", () => {
    const source = `
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype};
#[contracttype]
pub enum DataKey { Counter }
#[contract]
pub struct MyCounter;
#[contractimpl]
impl MyCounter {
  pub fn increment(env: soroban_sdk::Env) -> u64 { 0 }
}
`;
    const result = validator.validate(source);
    const issue = result.issues.find((i) => i.code === "REQUIRE_AUTH_MISSING");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(result.valid).toBe(false);
  });

  it("flags missing #[contract] macro", () => {
    const source = `
#![no_std]
use soroban_sdk::{contractimpl};
pub struct NoMacro;
#[contractimpl]
impl NoMacro {
  pub fn foo(addr: soroban_sdk::Address) { addr.require_auth(); }
}
`;
    const result = validator.validate(source);
    const issue = result.issues.find(
      (i) => i.code === "CONTRACT_MACRO_MISSING",
    );
    expect(issue).toBeDefined();
    expect(result.valid).toBe(false);
  });

  it("warns about use of .unwrap()", () => {
    const source = generator
      .preview("counter", "SafeCounter")
      .replace('.expect("already initialized")', ".unwrap()");
    const result = validator.validate(source);
    const issue = result.issues.find((i) => i.code === "UNSAFE_UNWRAP");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    // warnings alone do not mark the template invalid
    expect(result.valid).toBe(true);
  });
});

// ── listTemplates / getMetadata ───────────────────────────────────────────────

describe("SorobanTemplateGenerator – catalogue helpers", () => {
  const generator = new SorobanTemplateGenerator();

  it("listTemplates() returns four entries", () => {
    expect(generator.listTemplates()).toHaveLength(4);
  });

  it("getMetadata() returns correct metadata for each kind", () => {
    for (const kind of Object.keys(TEMPLATE_REGISTRY) as TemplateKind[]) {
      const meta = generator.getMetadata(kind);
      expect(meta.kind).toBe(kind);
    }
  });

  it("getMetadata() throws for unknown kind", () => {
    expect(() => generator.getMetadata("unknown" as TemplateKind)).toThrow(
      /Unknown template kind/,
    );
  });
});
