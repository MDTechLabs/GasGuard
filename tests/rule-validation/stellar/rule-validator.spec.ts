/**
 * Tests for Soroban Rule Validator
 */

import { describe, it, expect } from "@jest/globals";
import { RuleValidator } from "./rule-validator";
import {
  createTestDataset,
  allDatasets,
  TestDataset,
  TestSample,
} from "./test-datasets";

describe("RuleValidator", () => {
  const mockOwnerRule = (source: string) => {
    const findings: {
      ruleId: string;
      message: string;
      severity: string;
      line?: number;
    }[] = [];

    if (source.includes("set_owner") || source.includes("transfer_ownership")) {
      const hasAuth =
        source.includes("require_auth") ||
        source.includes("self.owner");
      if (!hasAuth) {
        findings.push({
          ruleId: "stellar-missing-auth",
          message: "set_owner function missing authentication",
          severity: "critical",
          line: 10,
        });
      }
    }

    if (source.includes("owner")) {
      findings.push({
        ruleId: "stellar-ownership-pattern",
        message: "Detected single-owner pattern",
        severity: "low",
        line: 1,
      });
    }

    return findings;
  };

  const mockAccessRule = (source: string) => {
    const findings: {
      ruleId: string;
      message: string;
      severity: string;
      line?: number;
    }[] = [];

    if (source.includes("require_auth")) {
      findings.push({
        ruleId: "stellar-access-control",
        message: "Detected role-based access control",
        severity: "low",
        line: 1,
      });
    }

    return findings;
  };

  const mockTimeLockRule = (source: string) => {
    const findings: {
      ruleId: string;
      message: string;
      severity: string;
      line?: number;
    }[] = [];

    if (source.includes("timestamp") && source.includes("delay")) {
      findings.push({
        ruleId: "stellar-time-lock",
        message: "Detected time-lock delay mechanism",
        severity: "info",
        line: 1,
      });
    }

    return findings;
  };

  it("should create a validator with rules", () => {
    const validator = new RuleValidator({
      "stellar-ownership-pattern": mockOwnerRule,
    });

    expect(validator).toBeDefined();
  });

  it("should register rules dynamically", () => {
    const validator = new RuleValidator();
    validator.registerRule("test-rule", mockOwnerRule);
    expect(validator).toBeDefined();
  });

  it("should validate a single sample", () => {
    const validator = new RuleValidator({
      "stellar-ownership-pattern": mockOwnerRule,
    });

    const sample: TestSample = {
      id: "test-1",
      name: "Test sample",
      description: "A test sample",
      input: `
use soroban_sdk::{contract, contractimpl, Address};

#[contractimpl]
impl Test {
    pub fn new(owner: Address) -> Self {
        Self { owner }
    }
}
`,
      expectedFindings: [
        {
          ruleId: "stellar-ownership-pattern",
          severity: "low",
          messagePattern: "single-owner",
        },
      ],
    };

    const result = validator.validateSample(sample);
    expect(result.passed).toBe(true);
    expect(result.matched).toHaveLength(1);
    expect(result.missed).toHaveLength(0);
  });

  it("should detect missed findings", () => {
    const validator = new RuleValidator({});

    const sample: TestSample = {
      id: "test-2",
      name: "Missing finding test",
      description: "Sample that should fail validation",
      input: "fn nothing() {}",
      expectedFindings: [
        {
          ruleId: "non-existent-rule",
          severity: "critical",
          messagePattern: "should not match",
        },
      ],
    };

    const result = validator.validateSample(sample);
    expect(result.passed).toBe(false);
    expect(result.missed).toHaveLength(1);
  });

  it("should validate an entire dataset", () => {
    const validator = new RuleValidator({
      "stellar-ownership-pattern": mockOwnerRule,
      "stellar-missing-auth": mockOwnerRule,
      "stellar-access-control": mockAccessRule,
      "stellar-time-lock": mockTimeLockRule,
    });

    const results = validator.validateAll(allDatasets);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.sample).toBeDefined();
      expect(typeof result.executionTimeMs).toBe("number");
    }
  });

  it("should generate a validation report", () => {
    const validator = new RuleValidator({});
    const results = validator.validateAll(allDatasets);
    const report = validator.generateReport(results);

    expect(report).toContain("SOROBAN RULE VALIDATION REPORT");
    expect(report).toContain("Total:");
    expect(report).toContain("Passed:");
    expect(report).toContain("Failed:");
  });

  it("should create a test dataset", () => {
    const dataset = createTestDataset("test-id", "Test Dataset", "A test", [
      {
        id: "sample-1",
        name: "Sample 1",
        description: "First sample",
        input: "fn test() {}",
        expectedFindings: [],
      },
    ]);

    expect(dataset.id).toBe("test-id");
    expect(dataset.samples).toHaveLength(1);
    expect(dataset.samples[0].id).toBe("sample-1");
  });

  it("should catch errors during validation", () => {
    const throwingRule = () => {
      throw new Error("Rule execution failed");
    };

    const validator = new RuleValidator({ "throwing-rule": throwingRule });

    const sample: TestSample = {
      id: "error-test",
      name: "Error test",
      description: "Sample that causes a rule to throw",
      input: "fn test() {}",
      expectedFindings: [],
    };

    const result = validator.validateSample(sample);
    expect(result.error).toBe("Rule execution failed");
    expect(result.passed).toBe(false);
  });
});
