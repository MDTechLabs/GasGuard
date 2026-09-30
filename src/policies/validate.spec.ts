import { POLICY_LIMITS, SECURE_DEFAULTS } from "./types";
import { validatePolicy } from "./validate";

function policy(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    name: "production",
    version: "1.0.0",
    mode: "enforce",
    gates: {
      minSeverity: "high",
      maxFindings: 0,
    },
    ...overrides,
  };
}

describe("validatePolicy", () => {
  it("accepts a complete policy and returns the normalized document", () => {
    const result = validatePolicy(
      policy({
        description: "Fail the build on high findings.",
        gates: {
          minSeverity: "high",
          maxFindings: 0,
          maxFindingsBySeverity: { critical: 0, high: 2 },
          ruleIds: ["SOL-001", "stellar.auth"],
          paths: ["contracts/**"],
        },
        scope: {
          include: ["**/*.rs"],
          exclude: ["target/**"],
        },
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.policy).toMatchObject({
      schemaVersion: "1",
      name: "production",
      version: "1.0.0",
      mode: "enforce",
      gates: {
        minSeverity: "high",
        maxFindings: 0,
        ruleIds: ["SOL-001", "stellar.auth"],
        paths: ["contracts/**"],
        maxFindingsBySeverity: { critical: 0, high: 2 },
      },
      scope: { include: ["**/*.rs"], exclude: ["target/**"] },
    });
  });

  it("applies fail-closed defaults when mode and minSeverity are omitted", () => {
    const result = validatePolicy({
      schemaVersion: "1",
      name: "prod",
      version: "0.0.0",
      gates: {},
    });

    expect(result.valid).toBe(true);
    expect(result.defaultsApplied).toEqual(["mode", "gates.minSeverity"]);
    expect(result.policy?.mode).toBe(SECURE_DEFAULTS.mode);
    expect(result.policy?.gates.minSeverity).toBe(SECURE_DEFAULTS.minSeverity);
    expect(result.policy?.gates.ruleIds).toEqual([]);
    expect(result.policy?.gates.paths).toEqual([]);
    expect(result.policy?.scope).toEqual({ include: [], exclude: [] });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "MISSING_MODE_DEFAULTED",
      "DEFAULT_MIN_SEVERITY",
      "NO_FINDING_CAP",
    ]);
  });

  it("rejects non-object documents", () => {
    for (const raw of [null, [], "policy", 1, true]) {
      const result = validatePolicy(raw);
      expect(result.valid).toBe(false);
      expect(result.errors[0]?.code).toBe("INVALID_ROOT_TYPE");
      expect(result.policy).toBeUndefined();
    }
  });

  it("reports every broken required field instead of stopping at the first", () => {
    const result = validatePolicy({
      schemaVersion: 1,
      name: "Production",
      version: "01.0.0",
      mode: "off",
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual([
      "INVALID_SCHEMA_VERSION",
      "INVALID_NAME",
      "INVALID_VERSION",
      "INVALID_MODE",
      "MISSING_GATES",
    ]);
  });

  it("rejects unknown and forbidden fields", () => {
    const result = validatePolicy(
      JSON.parse(
        '{"schemaVersion":"1","name":"production","version":"1.0.0","mode":"enforce","gates":{"minSeverity":"high","maxFindings":0},"__proto__":{"admin":true},"extends":"org-default"}',
      ),
    );

    expect(result.valid).toBe(false);
    expect(result.policy).toBeUndefined();
    expect(result.errors.map((error) => error.code).sort()).toEqual([
      "FORBIDDEN_FIELD",
      "UNKNOWN_FIELD",
    ]);
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it("accepts name and version boundaries and rejects the next step past them", () => {
    const maxName = `a${"b".repeat(POLICY_LIMITS.maxNameLength - 1)}`;
    expect(validatePolicy(policy({ name: "a" })).valid).toBe(true);
    expect(validatePolicy(policy({ name: maxName })).valid).toBe(true);
    expect(
      validatePolicy(policy({ name: `${maxName}c` })).errors[0]?.code,
    ).toBe("INVALID_NAME");
    expect(validatePolicy(policy({ name: "a-" })).errors[0]?.code).toBe(
      "INVALID_NAME",
    );
    expect(validatePolicy(policy({ name: "" })).errors[0]?.code).toBe(
      "INVALID_NAME",
    );
    expect(validatePolicy(policy({ version: "1.2.3-rc.1" })).valid).toBe(true);
    expect(validatePolicy(policy({ version: "1.0" })).errors[0]?.code).toBe(
      "INVALID_VERSION",
    );
    expect(validatePolicy(policy({ version: "1.0.0-" })).errors[0]?.code).toBe(
      "INVALID_VERSION",
    );
  });

  it("accepts a description at the length limit and rejects past it", () => {
    const limit = "a".repeat(POLICY_LIMITS.maxDescriptionLength);
    expect(validatePolicy(policy({ description: limit })).valid).toBe(true);
    expect(
      validatePolicy(policy({ description: `${limit}a` })).errors[0]?.code,
    ).toBe("INVALID_DESCRIPTION");
    expect(validatePolicy(policy({ description: "" })).errors[0]?.code).toBe(
      "INVALID_DESCRIPTION",
    );
    expect(validatePolicy(policy({ description: "line\nbreak" })).valid).toBe(
      true,
    );
    expect(
      validatePolicy(policy({ description: "bad\u0000char" })).errors[0]?.code,
    ).toBe("INVALID_DESCRIPTION");
  });

  it("warns when the policy is disabled or the severity gate is info", () => {
    const disabled = validatePolicy(policy({ mode: "disabled" }));
    expect(disabled.valid).toBe(true);
    expect(disabled.warnings.map((warning) => warning.code)).toContain(
      "POLICY_MODE_DISABLED",
    );

    const noisy = validatePolicy(
      policy({ gates: { minSeverity: "info", maxFindings: 1 } }),
    );
    expect(noisy.valid).toBe(true);
    expect(noisy.warnings.map((warning) => warning.code)).toContain(
      "NOISY_MIN_SEVERITY",
    );
  });

  it("enforces finding caps, rule ids, and closed severity keys", () => {
    expect(
      validatePolicy(policy({ gates: { minSeverity: "high", maxFindings: 0 } }))
        .valid,
    ).toBe(true);
    expect(
      validatePolicy(
        policy({
          gates: {
            minSeverity: "high",
            maxFindings: POLICY_LIMITS.maxFindings,
          },
        }),
      ).valid,
    ).toBe(true);

    const cases: Array<[unknown, string]> = [
      [-1, "INVALID_MAX_FINDINGS"],
      [1.5, "INVALID_MAX_FINDINGS"],
      [POLICY_LIMITS.maxFindings + 1, "INVALID_MAX_FINDINGS"],
      ["0", "INVALID_MAX_FINDINGS"],
    ];
    for (const [maxFindings, code] of cases) {
      const result = validatePolicy(
        policy({ gates: { minSeverity: "high", maxFindings } }),
      );
      expect(result.errors.map((error) => error.code)).toContain(code);
    }

    const duplicate = validatePolicy(
      policy({
        gates: {
          minSeverity: "low",
          ruleIds: ["SOL-001", "SOL-001"],
          maxFindings: 1,
        },
      }),
    );
    expect(duplicate.errors.map((error) => error.code)).toContain(
      "DUPLICATE_RULE_ID",
    );

    const badRule = validatePolicy(
      policy({
        gates: { minSeverity: "low", ruleIds: ["1SOL"], maxFindings: 1 },
      }),
    );
    expect(badRule.errors.map((error) => error.code)).toContain(
      "INVALID_RULE_ID",
    );

    const badCap = validatePolicy(
      policy({
        gates: {
          minSeverity: "high",
          maxFindingsBySeverity: { critical: 0, extreme: 1 },
        },
      }),
    );
    expect(badCap.errors.map((error) => error.code)).toContain("UNKNOWN_FIELD");

    const badCapValue = validatePolicy(
      policy({
        gates: {
          minSeverity: "high",
          maxFindingsBySeverity: { critical: -1 },
        },
      }),
    );
    expect(badCapValue.errors.map((error) => error.code)).toContain(
      "INVALID_SEVERITY_CAP",
    );
  });

  it("rejects path traversal, absolute paths, and oversized lists", () => {
    const paths = [
      "..",
      "foo/../../etc",
      "/etc/passwd",
      "C:/Windows",
      "a\\b",
      "",
      "a".repeat(POLICY_LIMITS.maxPathLength + 1),
    ];
    for (const entry of paths) {
      const result = validatePolicy(
        policy({
          gates: { minSeverity: "high", maxFindings: 0, paths: [entry] },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.code)).toContain(
        "INVALID_PATH",
      );
    }

    const tooMany = Array.from(
      { length: POLICY_LIMITS.maxListLength + 1 },
      (_, index) => `contracts/${index}.rs`,
    );
    const result = validatePolicy(
      policy({
        gates: { minSeverity: "high", maxFindings: 0, paths: tooMany },
      }),
    );
    expect(result.errors.map((error) => error.code)).toContain("LIST_TOO_LONG");
  });

  it("warns on duplicate paths and an empty scope but still accepts them", () => {
    const result = validatePolicy(
      policy({
        gates: {
          minSeverity: "medium",
          maxFindings: 3,
          paths: ["contracts/**", "contracts/**"],
        },
        scope: {},
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "DUPLICATE_PATH",
      "EMPTY_SCOPE",
    ]);
  });

  it("rejects a scope or gates value that is not an object", () => {
    expect(
      validatePolicy(policy({ gates: [] })).errors.map((error) => error.code),
    ).toContain("MISSING_GATES");
    expect(
      validatePolicy(policy({ scope: ["**/*.rs"] })).errors.map(
        (error) => error.code,
      ),
    ).toContain("INVALID_SCOPE");
    expect(
      validatePolicy(
        policy({
          gates: { minSeverity: "high", maxFindings: 0, ruleIds: "SOL-001" },
        }),
      ).errors.map((error) => error.code),
    ).toContain("INVALID_LIST");
  });
});
