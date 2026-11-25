import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import {
  ROLE_ADMIN_RULE_ID,
  validateRoleAdminGraph,
} from "./role-admin-graph-validator";

const fixtureDir = path.resolve(__dirname, "../../../tests/rules/fixtures");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "sol-027-role-admin-graph.json"), "utf8"),
) as {
  expectedFindings: Array<{
    ruleId: string;
    issueType: string;
    contractName: string;
    role: string;
    adminRole: string;
    line: number;
  }>;
};
const fixtureSource = fs.readFileSync(
  path.join(fixtureDir, "sol-027-role-admin-graph.sol"),
  "utf8",
);

describe("sol-027 role-admin graph validation for privileged role escalation", () => {
  it("reports expected findings in the positive/negative/inheritance/proxy fixture", () => {
    const report = validateRoleAdminGraph(fixtureSource);

    expect(report.diagnostics).toEqual([]);
    expect(
      report.findings.map(({ ruleId, issueType, contractName, role, adminRole, line }) => ({
        ruleId,
        issueType,
        contractName,
        role,
        adminRole,
        line,
      })),
    ).toEqual(fixture.expectedFindings);
  });

  it("does not report safe hierarchical role-admin graphs or guarded initializers", () => {
    const report = validateRoleAdminGraph(fixtureSource);
    const safeFindings = report.findings.filter(
      (f) => f.contractName === "SafeUpgradeableProtocol",
    );
    expect(safeFindings).toEqual([]);
  });

  it("detects multi-hop role-admin cycles", () => {
    const source = `
      pragma solidity ^0.8.20;
      contract CyclicRoles {
        bytes32 public constant ROLE_A = keccak256("ROLE_A");
        bytes32 public constant ROLE_B = keccak256("ROLE_B");
        bytes32 public constant ROLE_C = keccak256("ROLE_C");
        function _setRoleAdmin(bytes32, bytes32) internal {}
        constructor() {
          _setRoleAdmin(ROLE_B, ROLE_A);
          _setRoleAdmin(ROLE_C, ROLE_B);
          _setRoleAdmin(ROLE_A, ROLE_C);
        }
      }
    `;
    const report = validateRoleAdminGraph(source);
    const cycles = report.findings.filter((f) => f.issueType === "role-admin-cycle");
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    expect(cycles[0].escalationPath.length).toBe(4);
  });

  it("resolves role-admin edges wired through libraries and internal helpers", () => {
    const source = `
      pragma solidity ^0.8.20;
      library RoleAdminLib {
        function _setRoleAdmin(bytes32, bytes32) internal {}
        function wireEscalation(bytes32 upgrader, bytes32 operator) internal {
          _setRoleAdmin(upgrader, operator);
        }
      }
      contract Vault {
        bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
        bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
        constructor() {
          RoleAdminLib.wireEscalation(UPGRADER_ROLE, OPERATOR_ROLE);
        }
      }
    `;
    const report = validateRoleAdminGraph(source);
    expect(
      report.findings.some(
        (f) =>
          f.contractName === "Vault" &&
          f.issueType === "privilege-escalation-edge" &&
          f.role === "UPGRADER_ROLE" &&
          f.adminRole === "OPERATOR_ROLE",
      ),
    ).toBe(true);
  });

  it("handles Solidity 0.4.x legacy constructors without false-positive unprotected mutation", () => {
    const source = `
      pragma solidity ^0.4.24;
      contract LegacyAccess {
        bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
        bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
        function _setRoleAdmin(bytes32, bytes32) internal {}
        function LegacyAccess() public {
          _setRoleAdmin(OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
        }
      }
    `;
    const report = validateRoleAdminGraph(source);
    expect(report.diagnostics).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.toolchain.pragmaSolidity).toBe("^0.4.24");
  });

  it("supports extraPrivilegedRoles and allowedAdminEdges configuration for false-positive handling", () => {
    const source = `
      pragma solidity ^0.8.20;
      contract CustomPolicy {
        bytes32 public constant CUSTOM_TREASURY_KEY = keccak256("CUSTOM_TREASURY_KEY");
        bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
        bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
        function _setRoleAdmin(bytes32, bytes32) internal {}
        constructor() {
          _setRoleAdmin(CUSTOM_TREASURY_KEY, OPERATOR_ROLE);
          _setRoleAdmin(PAUSER_ROLE, OPERATOR_ROLE);
        }
      }
    `;
    const flagged = validateRoleAdminGraph(source, {
      extraPrivilegedRoles: ["CUSTOM_TREASURY_KEY"],
    });
    expect(flagged.findings).toHaveLength(1);
    expect(flagged.findings[0].role).toBe("CUSTOM_TREASURY_KEY");

    const suppressed = validateRoleAdminGraph(source, {
      extraPrivilegedRoles: ["CUSTOM_TREASURY_KEY"],
      allowedAdminEdges: [{ role: "CUSTOM_TREASURY_KEY", adminRole: "OPERATOR_ROLE" }],
    });
    expect(suppressed.findings).toEqual([]);
  });

  it("produces deterministic findings, graph, and inputDigest across repeated runs", () => {
    const first = validateRoleAdminGraph(fixtureSource);
    const second = validateRoleAdminGraph(fixtureSource);

    expect(first).toEqual(second);
    expect(first.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.toolchain).toEqual({
      analyzer: "RoleAdminGraphValidator",
      validatorVersion: "1.0.0",
      pragmaSolidity: "^0.8.20",
      analysisMode: "static-source-pattern",
      executesRepoCode: false,
    });
  });

  it("fails safely on malformed source, unsupported pragmas, NUL bytes, and non-string input", () => {
    expect(validateRoleAdminGraph("contract Broken { constructor() {").diagnostics[0]).toContain(
      "unbalanced delimiters",
    );
    expect(validateRoleAdminGraph('contract S { string x = "unterminated; }').diagnostics[0]).toContain(
      "unterminated comment or string",
    );
    expect(validateRoleAdminGraph("pragma solidity ^0.9.0; contract Future {}").diagnostics[0]).toContain(
      "0.4.x through 0.8.x",
    );
    expect(validateRoleAdminGraph("contract Nul {\0}").diagnostics[0]).toContain("NUL byte");
    expect(validateRoleAdminGraph(12345).diagnostics[0]).toContain("requires Solidity source text");
  });

  it("enforces resource limits on source size, contract count, and graph size", () => {
    const oversized = validateRoleAdminGraph("contract A {}", { maxSourceBytes: 5 });
    expect(oversized.diagnostics[0]).toContain("exceeds limit");
    expect(oversized.findings).toEqual([]);

    const tooManyContracts = validateRoleAdminGraph(
      "contract A {} contract B {} contract C {}",
      { maxContracts: 2 },
    );
    expect(tooManyContracts.diagnostics[0]).toContain("contract count 3 exceeds limit of 2");

    const edgeLimited = validateRoleAdminGraph(fixtureSource, { maxGraphEdges: 1 });
    expect(edgeLimited.diagnostics.some((d) => d.includes("edge limit"))).toBe(true);
  });

  it("integrates with SolidityAnalyzer and normalizeAnalysisResult", async () => {
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-027-role-admin-graph.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === ROLE_ADMIN_RULE_ID }]),
    );
    const result = await analyzer.analyze(fixtureSource, file, { rules });
    const normalized = normalizeAnalysisResult(result);

    expect(result.errors).toBeUndefined();
    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: ROLE_ADMIN_RULE_ID,
      location: { file, startLine: 31 },
      metadata: {
        issueType: "privilege-escalation-edge",
        contractName: "VulnerableGovernance",
        role: "UPGRADER_ROLE",
        adminRole: "OPERATOR_ROLE",
        escalationPath: ["OPERATOR_ROLE", "UPGRADER_ROLE"],
        toolchain: expect.objectContaining({
          analyzer: "RoleAdminGraphValidator",
          executesRepoCode: false,
        }),
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings).toHaveLength(fixture.expectedFindings.length);
  });
});
