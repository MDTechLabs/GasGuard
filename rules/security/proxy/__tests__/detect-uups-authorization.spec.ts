import { detectUupsAuthorization } from "../detect-uups-authorization";

const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

describe("detectUupsAuthorization", () => {
  it("flags an empty _authorizeUpgrade", () => {
    const code = `
contract Vault is UUPSUpgradeable {
    function _authorizeUpgrade(address newImpl) internal override {}
}`;
    const result = detectUupsAuthorization(code);
    expect(result.findings.some((f) => f.title === "Unrestricted _authorizeUpgrade")).toBe(true);
    expect(result.findings[0].line).toBe(3);
  });

  it("accepts an onlyOwner _authorizeUpgrade and the standard slot", () => {
    const code = `
contract Vault is UUPSUpgradeable, OwnableUpgradeable {
    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}
    function proxiableUUID() external pure override returns (bytes32) { return ${SLOT}; }
}`;
    expect(detectUupsAuthorization(code).detected).toBe(false);
  });

  it("flags a nonstandard proxiableUUID", () => {
    const code = `
contract Vault is UUPSUpgradeable {
    function _authorizeUpgrade(address newImpl) internal override onlyOwner {}
    function proxiableUUID() external pure override returns (bytes32) { return bytes32(0); }
}`;
    expect(detectUupsAuthorization(code).findings.map((f) => f.title)).toContain("Nonstandard proxiable UUID");
  });

  it("fails safely on malformed source", () => {
    const result = detectUupsAuthorization("contract Broken is UUPSUpgradeable {");
    expect(result.findings).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(true);
  });
});
