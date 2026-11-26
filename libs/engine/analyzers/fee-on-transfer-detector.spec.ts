import * as fs from "fs";
import * as path from "path";
import { normalizeAnalysisResult } from "../core/result-normalizer";
import { SolidityAnalyzer } from "./solidity-analyzer";
import { detectFeeOnTransferAccounting } from "./fee-on-transfer-detector";

const fixtureDir = path.resolve(__dirname, "../../../tests/rules/fixtures");
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "sol-025-fee-on-transfer.json"), "utf8"),
) as {
  expectedFindings: Array<{ kind: string; flow: string; policy: string; line: number }>;
  suppressedByPolicy: Array<{ line: number }>;
};
const source = fs.readFileSync(path.join(fixtureDir, "sol-025-fee-on-transfer.sol"), "utf8");

describe("sol-025 fee-on-transfer accounting", () => {
  it("reports the positive deposit, liquidity, swap, and withdrawal flows in the fixture", () => {
    const { findings, diagnostics } = detectFeeOnTransferAccounting(source);

    expect(diagnostics).toEqual([]);
    expect(findings.map(({ kind, flow, policy, line }) => ({ kind, flow, policy, line }))).toEqual(
      fixture.expectedFindings.map(({ kind, flow, policy, line }) => ({ kind, flow, policy, line })),
    );
  });

  it("does not report balance-delta deposits, swaps, or withdrawals", () => {
    const lines = detectFeeOnTransferAccounting(source).findings.map((f) => f.line);

    expect(lines).not.toContain(46); // DeltaVault.deposit
    expect(lines).not.toContain(100); // DeltaSwap.swap
    expect(lines).not.toContain(137); // SharesVault.withdraw spends its own balance
    expect(lines.filter((l) => l >= 120 && l < 137)).toEqual([]); // DeltaForwardingVault
  });

  it("distinguishes an explicit unsupported-token policy from an accidental assumption", () => {
    const result = detectFeeOnTransferAccounting(source);
    const byLine = Object.fromEntries(result.findings.map((f) => [f.line, f]));

    expect(result.suppressedByPolicy.map((s) => s.line)).toEqual(
      fixture.suppressedByPolicy.map((s) => s.line),
    );
    expect(byLine[20].policy).toBe("unspecified");
    expect(byLine[33].policy).toBe("claimed-support");
    expect(byLine[33].confidence).toBeGreaterThan(byLine[20].confidence);
  });

  it("ignores NFT-style transferFrom, pulls to other recipients, and comments or strings", () => {
    const { findings } = detectFeeOnTransferAccounting(`
      contract C {
        mapping(address => uint256) balances;
        function a(address nft, uint256 id) external {
          nft.transferFrom(msg.sender, address(this), id);
          balances[msg.sender] += id;
        }
        function b(IERC20 token, uint256 amount) external {
          token.transferFrom(msg.sender, treasury, amount);
          balances[msg.sender] += amount;
        }
        function c(IERC20 token, uint256 amount) external {
          // token.transferFrom(msg.sender, address(this), amount); balances[msg.sender] += amount;
          string memory s = "token.transferFrom(msg.sender, address(this), amount)";
        }
      }
    `);

    expect(findings).toEqual([]);
  });

  it("recognises the SafeERC20 library form and derived share accounting", () => {
    const { findings } = detectFeeOnTransferAccounting(`
      contract V {
        uint256 totalShares; uint256 totalAssets; mapping(address => uint256) shares;
        function deposit(address token, uint256 assets) external {
          SafeERC20.safeTransferFrom(token, msg.sender, address(this), assets);
          uint256 minted = assets * totalShares / totalAssets;
          shares[msg.sender] += minted;
        }
      }
    `);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "nominal-credit", flow: "deposit", line: 5 });
  });

  it("reports diagnostics and skips malformed, unsupported, or non-string input", () => {
    expect(detectFeeOnTransferAccounting("contract B { function f() {").diagnostics[0]).toContain(
      "unbalanced delimiters",
    );
    expect(
      detectFeeOnTransferAccounting("pragma solidity ^0.9.0; contract F {}").diagnostics[0],
    ).toContain("0.4.x through 0.8.x");
    expect(detectFeeOnTransferAccounting(null).diagnostics[0]).toContain("requires Solidity source text");
  });

  it("integrates with the analyzer and the normalized finding schema", async () => {
    const analyzer = new SolidityAnalyzer();
    const file = "tests/rules/fixtures/sol-025-fee-on-transfer.sol";
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === "sol-025" }]),
    );
    const result = await analyzer.analyze(source, file, { rules });
    const normalized = normalizeAnalysisResult(result);

    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: "sol-025",
      location: { file, startLine: 20 },
      metadata: {
        kind: "nominal-credit",
        policy: "unspecified",
        confidenceEvidence: expect.any(Array),
        severityRationale: expect.any(String),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings).toHaveLength(fixture.expectedFindings.length);
  });
});
