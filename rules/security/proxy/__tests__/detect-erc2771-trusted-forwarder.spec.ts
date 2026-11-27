import { detectErc2771TrustedForwarder } from "../detect-erc2771-trusted-forwarder";

describe("detectErc2771TrustedForwarder", () => {
  it("flags sender suffix decoding without a trusted-forwarder check", () => {
    const source = `
contract Context {
    function _msgSender() internal view returns (address sender) {
        assembly { sender := shr(96, calldataload(sub(calldatasize(), 20))) }
    }
}`;
    const result = detectErc2771TrustedForwarder(source);
    expect(result.findings[0]).toMatchObject({
      ruleId: "erc2771-trusted-forwarder",
      title: "Calldata sender suffix is not authenticated",
      line: 3,
      severity: "high",
    });
  });

  it("recognizes forwarder checks and authorized updates", () => {
    const source = `
contract Context {
    address private trustedForwarder;
    function _msgSender() internal view returns (address sender) {
        if (msg.sender == trustedForwarder) {
            assembly { sender := shr(96, calldataload(sub(calldatasize(), 20))) }
        } else {
            return msg.sender;
        }
    }
    function setTrustedForwarder(address next) external onlyOwner {
        trustedForwarder = next;
    }
}`;
    expect(detectErc2771TrustedForwarder(source).findings).toEqual([]);
  });

  it("flags raw caller authorization and an unprotected forwarder update through inheritance", () => {
    const source = `
abstract contract ERC2771Context {}
contract Vault is ERC2771Context {
    address trustedForwarder;
    address owner;
    function withdraw() external {
        require(msg.sender == owner);
    }
    function setTrustedForwarder(address next) external {
        trustedForwarder = next;
    }
}`;
    const result = detectErc2771TrustedForwarder(source);
    expect(result.findings.map((finding) => finding.title)).toEqual([
      "Raw msg.sender used with ERC-2771 context",
      "Trusted forwarder can be changed without authorization",
    ]);
    expect(result.findings.map((finding) => finding.line)).toEqual([6, 9]);
  });

  it("does not report a forwarder-derived sender check or unrelated contracts", () => {
    const source = `
abstract contract ERC2771Context {}
contract Vault is ERC2771Context {
    address owner;
    function withdraw() external {
        require(_msgSender() == owner);
    }
}
contract Other {
    address owner;
    function withdraw() external {
        require(msg.sender == owner);
    }
}`;
    expect(detectErc2771TrustedForwarder(source).findings).toEqual([]);
  });

  it("fails safely on malformed Solidity", () => {
    const result = detectErc2771TrustedForwarder("contract Broken {");
    expect(result.findings).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(true);
  });
});
