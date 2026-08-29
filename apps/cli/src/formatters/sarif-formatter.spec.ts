import {
  RuleMatch,
  toSarif,
  toSarifLevel,
  toSarifString,
} from "./sarif-formatter";

function makeMatch(overrides: Partial<RuleMatch> = {}): RuleMatch {
  return {
    ruleId: "GG001",
    ruleName: "cached-array-length",
    message: "Cache array length outside the loop",
    file: "contracts/Token.sol",
    line: 12,
    column: 5,
    severity: "medium",
    gasSavings: 200,
    ...overrides,
  };
}

describe("sarif-formatter", () => {
  it("produces a SARIF v2.1.0 log with the required top-level shape", () => {
    const sarif = toSarif([makeMatch()]);
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toContain("sarif-schema-2.1.0.json");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe("GasGuard");
  });

  it("maps a rule match into a SARIF result with a physical location", () => {
    const sarif = toSarif([makeMatch()]);
    const result = sarif.runs[0].results[0];
    expect(result.ruleId).toBe("GG001");
    expect(result.level).toBe("warning");
    expect(result.message.text).toBe("Cache array length outside the loop");
    const region = result.locations[0].physicalLocation.region;
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "contracts/Token.sol",
    );
    expect(region.startLine).toBe(12);
    expect(region.startColumn).toBe(5);
  });

  it("deduplicates rule descriptors in the driver", () => {
    const sarif = toSarif([
      makeMatch({ ruleId: "GG001" }),
      makeMatch({ ruleId: "GG001", line: 20 }),
      makeMatch({ ruleId: "GG002" }),
    ]);
    const ruleIds = sarif.runs[0].tool.driver.rules.map((r) => r.id).sort();
    expect(ruleIds).toEqual(["GG001", "GG002"]);
    expect(sarif.runs[0].results).toHaveLength(3);
  });

  it("maps severities to SARIF levels", () => {
    expect(toSarifLevel("critical")).toBe("error");
    expect(toSarifLevel("high")).toBe("error");
    expect(toSarifLevel("medium")).toBe("warning");
    expect(toSarifLevel("low")).toBe("warning");
    expect(toSarifLevel("info")).toBe("note");
  });

  it("serializes to valid, parseable JSON", () => {
    const json = toSarifString([makeMatch()]);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("2.1.0");
  });
});
