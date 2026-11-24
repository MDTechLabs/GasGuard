import {
  computeFindingFingerprint,
  enclosingNames,
  FINGERPRINT_VERSION,
  flaggedSource,
  normalizeSource,
} from "./finding-fingerprint";

const VAULT = [
  "pragma solidity ^0.8.20;",
  "",
  "contract Vault {",
  "    mapping(address => uint256) public balances;",
  "",
  "    function withdraw(uint256 amount) external {",
  "        balances[msg.sender] -= amount;",
  "        payable(msg.sender).transfer(amount);",
  "    }",
  "}",
].join("\n");

const WITHDRAW_LINE = 6;
const finding = (startLine = WITHDRAW_LINE, file = "contracts/Vault.sol") => ({
  ruleId: "sol-006",
  location: { file, startLine, endLine: startLine },
});

describe("computeFindingFingerprint", () => {
  it("is deterministic for the same input", () => {
    const a = computeFindingFingerprint(finding(), VAULT);
    const b = computeFindingFingerprint(finding(), VAULT);
    expect(a).toEqual(b);
    expect(a.value).toMatch(/^[0-9a-f]{32}$/);
    expect(a.version).toBe(FINGERPRINT_VERSION);
  });

  it("does not change when lines are added above the finding", () => {
    const shifted = ["// audit note", "// second note", "", VAULT].join("\n");
    const before = computeFindingFingerprint(finding(WITHDRAW_LINE), VAULT);
    const after = computeFindingFingerprint(finding(WITHDRAW_LINE + 3), shifted);
    expect(after.value).toBe(before.value);
  });

  it("does not change when comments or whitespace in the flagged code change", () => {
    const reformatted = VAULT.replace(
      "        payable(msg.sender).transfer(amount);",
      "        payable(msg.sender).transfer(amount);   // paid out",
    );
    const before = computeFindingFingerprint(finding(), VAULT);
    const after = computeFindingFingerprint(finding(), reformatted);
    expect(after.value).toBe(before.value);
  });

  it("does not change when the message or the path is moved, by default", () => {
    const before = computeFindingFingerprint(finding(WITHDRAW_LINE, "contracts/Vault.sol"), VAULT);
    const moved = computeFindingFingerprint(finding(WITHDRAW_LINE, "src/moved/Vault.sol"), VAULT);
    expect(moved.value).toBe(before.value);
  });

  it("changes when the file path is included on request", () => {
    const opts = { includePath: true };
    const before = computeFindingFingerprint(finding(WITHDRAW_LINE, "contracts/Vault.sol"), VAULT, opts);
    const moved = computeFindingFingerprint(finding(WITHDRAW_LINE, "src/moved/Vault.sol"), VAULT, opts);
    expect(moved.value).not.toBe(before.value);
  });

  it("changes when the rule id changes", () => {
    const other = { ...finding(), ruleId: "sol-007" };
    expect(computeFindingFingerprint(other, VAULT).value).not.toBe(
      computeFindingFingerprint(finding(), VAULT).value,
    );
  });

  it("changes when the flagged code itself changes", () => {
    const edited = VAULT.replace("transfer(amount)", "transfer(amount / 2)");
    expect(computeFindingFingerprint(finding(), edited).value).not.toBe(
      computeFindingFingerprint(finding(), VAULT).value,
    );
  });

  it("changes when the enclosing function is renamed", () => {
    const renamed = VAULT.replace("function withdraw", "function exit");
    expect(computeFindingFingerprint(finding(), renamed).value).not.toBe(
      computeFindingFingerprint(finding(), VAULT).value,
    );
  });

  it("separates two findings with the same rule in different contracts", () => {
    const twin = VAULT.replace("contract Vault", "contract Vault2");
    expect(computeFindingFingerprint(finding(), twin).value).not.toBe(
      computeFindingFingerprint(finding(), VAULT).value,
    );
  });

  it("does not throw on malformed locations and still returns a fingerprint", () => {
    const bad = { ruleId: "sol-006", location: { file: "x.sol", startLine: -4 } };
    expect(() => computeFindingFingerprint(bad, VAULT)).not.toThrow();
    expect(computeFindingFingerprint(bad, VAULT).value).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("enclosingNames", () => {
  it("finds the contract and function that contain a line", () => {
    expect(enclosingNames(VAULT, WITHDRAW_LINE)).toEqual({ container: "Vault", symbol: "withdraw" });
  });

  it("returns nulls for lines before any declaration", () => {
    expect(enclosingNames(VAULT, 1)).toEqual({ container: null, symbol: null });
  });

  it("returns nulls for invalid input instead of throwing", () => {
    expect(enclosingNames(VAULT, Number.NaN)).toEqual({ container: null, symbol: null });
    expect(enclosingNames(undefined as unknown as string, 3)).toEqual({ container: null, symbol: null });
  });
});

describe("normalizeSource", () => {
  it("removes block and line comments and collapses whitespace", () => {
    expect(normalizeSource("a   /* x */ b // y\n   c")).toBe("a b c");
  });
});

describe("flaggedSource", () => {
  it("returns the normalized span and an empty string outside the file", () => {
    expect(flaggedSource(VAULT, WITHDRAW_LINE, WITHDRAW_LINE)).toContain("transfer(amount)");
    expect(flaggedSource(VAULT, 999)).toBe("");
  });
});
