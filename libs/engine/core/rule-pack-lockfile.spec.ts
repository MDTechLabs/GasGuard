import {
  generateLockfile,
  parseLockfile,
  serializeLockfile,
  validateLockfile,
  LOCKFILE_SCHEMA_VERSION,
  type RulePackDescriptor,
  type RulePackLockfile,
} from "./rule-pack-lockfile";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const FIXED_NOW = "2024-01-15T10:00:00.000Z";
const fixedClock = () => FIXED_NOW;

/** Realistic two-pack scenario: a security pack that depends on a base pack. */
const REALISTIC_PACKS: RulePackDescriptor[] = [
  {
    name: "gasguard-base",
    version: "1.2.0",
    integrity: "a".repeat(64),
    dependencies: [],
  },
  {
    name: "gasguard-security",
    version: "2.0.1",
    integrity: "b".repeat(64),
    dependencies: ["gasguard-base"],
  },
];

/** Regression: a pack with no declared integrity (common during initial lock). */
const NO_INTEGRITY_PACK: RulePackDescriptor = {
  name: "gasguard-experimental",
  version: "0.1.0",
  dependencies: [],
};

// ─── parseLockfile ─────────────────────────────────────────────────────────────

describe("parseLockfile", () => {
  it("parses a valid lockfile object", () => {
    const lockfile = generateLockfile(REALISTIC_PACKS, fixedClock);
    const raw = JSON.parse(serializeLockfile(lockfile));
    const result = parseLockfile(raw);

    expect(result.valid).toBe(true);
    expect(result.lockfile).toBeDefined();
    expect(result.lockfile!.schemaVersion).toBe(LOCKFILE_SCHEMA_VERSION);
    expect(Object.keys(result.lockfile!.packs)).toHaveLength(2);
  });

  it("parses a valid lockfile from a JSON string", () => {
    const lockfile = generateLockfile(REALISTIC_PACKS, fixedClock);
    const json = serializeLockfile(lockfile);
    const result = parseLockfile(json);

    expect(result.valid).toBe(true);
    expect(result.lockfile).toBeDefined();
  });

  it("returns a fatal issue for invalid JSON string", () => {
    const result = parseLockfile("not json {{{");

    expect(result.valid).toBe(false);
    expect(result.lockfile).toBeUndefined();
    expect(result.issues[0]?.code).toBe("MALFORMED_LOCKFILE");
    expect(result.issues[0]?.fatal).toBe(true);
  });

  it("returns a fatal issue for non-object root", () => {
    const result = parseLockfile([1, 2, 3]);

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("MALFORMED_LOCKFILE");
  });

  it("returns a fatal issue for unknown schemaVersion", () => {
    const result = parseLockfile({ schemaVersion: 999, lockedAt: FIXED_NOW, packs: {} });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("UNKNOWN_SCHEMA_VERSION");
  });

  it("skips pack entries that are not objects but keeps valid ones", () => {
    const raw = {
      schemaVersion: LOCKFILE_SCHEMA_VERSION,
      lockedAt: FIXED_NOW,
      packs: {
        "good-pack": { version: "1.0.0", integrity: "", dependencies: [], resolvedAt: FIXED_NOW },
        "bad-pack": "not-an-object",
      },
    };
    const result = parseLockfile(raw);

    // The malformed entry is skipped (non-fatal issue) but the rest is usable.
    expect(result.valid).toBe(true);
    expect(result.lockfile!.packs["good-pack"]).toBeDefined();
    expect(result.lockfile!.packs["bad-pack"]).toBeUndefined();
    expect(result.issues.some((i) => i.code === "INVALID_ENTRY")).toBe(true);
  });

  it("preserves unknown top-level keys in extra", () => {
    const raw = {
      schemaVersion: LOCKFILE_SCHEMA_VERSION,
      lockedAt: FIXED_NOW,
      packs: {},
      futureField: "some-future-value",
    };
    const result = parseLockfile(raw);

    expect(result.valid).toBe(true);
    expect(result.lockfile!.extra?.futureField).toBe("some-future-value");
  });

  it("regression: pack with missing version is skipped with INVALID_ENTRY", () => {
    const raw = {
      schemaVersion: LOCKFILE_SCHEMA_VERSION,
      lockedAt: FIXED_NOW,
      packs: {
        "no-version": { integrity: "", dependencies: [], resolvedAt: FIXED_NOW },
      },
    };
    const result = parseLockfile(raw);

    expect(result.lockfile!.packs["no-version"]).toBeUndefined();
    expect(result.issues.some((i) => i.code === "INVALID_ENTRY" && i.pack === "no-version")).toBe(true);
  });
});

// ─── generateLockfile ─────────────────────────────────────────────────────────

describe("generateLockfile", () => {
  it("produces a lockfile with sorted pack names", () => {
    const packs = [
      { name: "zzz-pack", version: "1.0.0" },
      { name: "aaa-pack", version: "2.0.0" },
    ];
    const lockfile = generateLockfile(packs, fixedClock);
    const names = Object.keys(lockfile.packs);

    expect(names[0]).toBe("aaa-pack");
    expect(names[1]).toBe("zzz-pack");
  });

  it("uses the provided clock for lockedAt and resolvedAt", () => {
    const lockfile = generateLockfile(REALISTIC_PACKS, fixedClock);

    expect(lockfile.lockedAt).toBe(FIXED_NOW);
    expect(lockfile.packs["gasguard-base"]?.resolvedAt).toBe(FIXED_NOW);
  });

  it("defaults integrity to empty string when not provided", () => {
    const lockfile = generateLockfile([NO_INTEGRITY_PACK], fixedClock);

    expect(lockfile.packs["gasguard-experimental"]?.integrity).toBe("");
  });

  it("realistic: generates a deterministic lockfile for a two-pack set", () => {
    const a = generateLockfile(REALISTIC_PACKS, fixedClock);
    const b = generateLockfile([...REALISTIC_PACKS].reverse(), fixedClock);

    // Regardless of input order the output must be identical.
    expect(serializeLockfile(a)).toBe(serializeLockfile(b));
  });
});

// ─── serializeLockfile ────────────────────────────────────────────────────────

describe("serializeLockfile", () => {
  it("round-trips through parseLockfile", () => {
    const original = generateLockfile(REALISTIC_PACKS, fixedClock);
    const json = serializeLockfile(original);
    const { lockfile: restored } = parseLockfile(json);

    expect(restored).toBeDefined();
    expect(restored!.packs["gasguard-base"]?.version).toBe("1.2.0");
    expect(restored!.packs["gasguard-security"]?.dependencies).toEqual(["gasguard-base"]);
  });

  it("produces byte-identical output for identical logical content", () => {
    const a = serializeLockfile(generateLockfile(REALISTIC_PACKS, fixedClock));
    const b = serializeLockfile(generateLockfile(REALISTIC_PACKS, fixedClock));

    expect(a).toBe(b);
  });

  it("ends with a newline", () => {
    const json = serializeLockfile(generateLockfile([], fixedClock));
    expect(json.endsWith("\n")).toBe(true);
  });
});

// ─── validateLockfile ─────────────────────────────────────────────────────────

describe("validateLockfile", () => {
  function makeLockfile(packs: RulePackDescriptor[]): RulePackLockfile {
    return generateLockfile(packs, fixedClock);
  }

  it("passes when requested packs match the lockfile exactly", () => {
    const lockfile = makeLockfile(REALISTIC_PACKS);
    const result = validateLockfile(lockfile, REALISTIC_PACKS);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports MISSING_PACK_ENTRY when a required pack is absent", () => {
    const lockfile = makeLockfile([REALISTIC_PACKS[0]!]);
    const result = validateLockfile(lockfile, REALISTIC_PACKS);

    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.code === "MISSING_PACK_ENTRY");
    expect(issue).toBeDefined();
    expect(issue!.pack).toBe("gasguard-security");
  });

  it("reports VERSION_MISMATCH when versions differ", () => {
    const lockfile = makeLockfile(REALISTIC_PACKS);
    const requested: RulePackDescriptor[] = [
      { name: "gasguard-base", version: "9.9.9" },
    ];
    const result = validateLockfile(lockfile, requested);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "VERSION_MISMATCH")).toBe(true);
  });

  it("reports INTEGRITY_MISMATCH when both sides have a hash and they differ", () => {
    const lockfile = makeLockfile(REALISTIC_PACKS);
    const requested: RulePackDescriptor[] = [
      { name: "gasguard-base", version: "1.2.0", integrity: "c".repeat(64) },
    ];
    const result = validateLockfile(lockfile, requested);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "INTEGRITY_MISMATCH")).toBe(true);
  });

  it("does NOT report integrity mismatch when lockfile entry has empty integrity", () => {
    const lockfile = makeLockfile([
      { name: "gasguard-base", version: "1.2.0", integrity: "", dependencies: [] },
    ]);
    const requested: RulePackDescriptor[] = [
      { name: "gasguard-base", version: "1.2.0", integrity: "a".repeat(64) },
    ];
    const result = validateLockfile(lockfile, requested);

    expect(result.valid).toBe(true);
  });

  it("reports MISSING_DEPENDENCY when a declared dep is absent from the lockfile", () => {
    const packs: RulePackDescriptor[] = [
      {
        name: "gasguard-security",
        version: "2.0.1",
        dependencies: ["gasguard-base"],
      },
      // gasguard-base deliberately omitted
    ];
    const lockfile = makeLockfile(packs);
    const result = validateLockfile(lockfile, packs);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "MISSING_DEPENDENCY")).toBe(true);
  });

  it("reports CIRCULAR_DEPENDENCY for a direct cycle", () => {
    // Manually craft a lockfile with a cycle since generateLockfile does not validate.
    const lockfile: RulePackLockfile = {
      schemaVersion: LOCKFILE_SCHEMA_VERSION,
      lockedAt: FIXED_NOW,
      packs: {
        "pack-a": { version: "1.0.0", integrity: "", dependencies: ["pack-b"], resolvedAt: FIXED_NOW },
        "pack-b": { version: "1.0.0", integrity: "", dependencies: ["pack-a"], resolvedAt: FIXED_NOW },
      },
    };
    const result = validateLockfile(lockfile, []);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "CIRCULAR_DEPENDENCY")).toBe(true);
  });

  it("regression: empty lockfile with no requested packs is valid", () => {
    const lockfile = makeLockfile([]);
    const result = validateLockfile(lockfile, []);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("realistic: full two-pack lifecycle — generate, serialize, parse, validate", () => {
    const generated = generateLockfile(REALISTIC_PACKS, fixedClock);
    const json = serializeLockfile(generated);
    const { lockfile, valid: parseValid } = parseLockfile(json);

    expect(parseValid).toBe(true);

    const { valid, issues } = validateLockfile(lockfile!, REALISTIC_PACKS);

    expect(valid).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
