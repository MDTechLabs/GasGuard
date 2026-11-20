import { detectMissingDomainSeparation } from "../detect-missing-domain-separation";

const claim = (digestLine: string, recover = "address signer = ECDSA.recover(digest, sig);") => `pragma solidity ^0.8.20;
contract Claims {
  function claim(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    ${digestLine}
    ${recover}
  }
}`;

describe("detectMissingDomainSeparation", () => {
  it("flags a payload bound to neither contract nor chain (cross-contract and cross-chain replay)", () => {
    const result = detectMissingDomainSeparation(claim("bytes32 digest = keccak256(abi.encodePacked(to, amount, nonce));"));
    expect(result.detected).toBe(true);
    const f = result.findings[0];
    expect(f.severity).toBe("high");
    expect(f.message).toContain("across contracts and across chains");
    expect(f.evidence.join(" ")).toContain("signed fields: to, amount, nonce");
    expect(f.line).toBe(5);
  });

  it("reports partial binding: cross-chain replay when only address(this) is signed", () => {
    const result = detectMissingDomainSeparation(claim("bytes32 digest = keccak256(abi.encodePacked(address(this), to, amount, nonce));"));
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].message).toContain("without the chain id");
  });

  it("reports partial binding: cross-contract replay when only block.chainid is signed", () => {
    const result = detectMissingDomainSeparation(claim("bytes32 digest = keccak256(abi.encodePacked(block.chainid, to, amount, nonce));"));
    expect(result.findings[0].severity).toBe("medium");
    expect(result.findings[0].message).toContain("without the contract address");
  });

  it("accepts equivalent custom binding with both chain id and contract address", () => {
    const code = claim("bytes32 digest = keccak256(abi.encode(block.chainid, address(this), to, amount, nonce));");
    expect(detectMissingDomainSeparation(code).detected).toBe(false);
  });

  it("accepts EIP-712 typed-data hashing and a stored domain separator", () => {
    const typed = claim("bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(TYPEHASH, to, amount, nonce)));");
    const stored = claim('bytes32 digest = keccak256(abi.encodePacked("\\x19\\x01", DOMAIN_SEPARATOR, keccak256(abi.encode(TYPEHASH, to, amount, nonce))));');
    expect(detectMissingDomainSeparation(typed).detected).toBe(false);
    expect(detectMissingDomainSeparation(stored).detected).toBe(false);
  });

  it("resolves an in-file hashing helper in both directions", () => {
    const helper = (body: string) => `contract C {
  struct Order { address maker; uint256 amount; }
  function hashOrder(Order memory o) internal pure returns (bytes32) {
    return keccak256(abi.encode(${body}));
  }
  function fill(Order memory order, bytes memory sig) external {
    bytes32 digest = hashOrder(order);
    address signer = ECDSA.recover(digest, sig);
  }
}`;
    expect(detectMissingDomainSeparation(helper("o.maker, o.amount")).detected).toBe(true);
    expect(detectMissingDomainSeparation(helper("block.chainid, address(this), o.maker, o.amount")).detected).toBe(false);
  });

  it("covers SignatureChecker and an EIP-191 prefixed digest", () => {
    const checker = `contract C {
  function f(address signer, address to, bytes memory sig) external view {
    bytes32 digest = keccak256(abi.encodePacked(to));
    require(SignatureChecker.isValidSignatureNow(signer, digest, sig));
  }
}`;
    const prefixed = claim("bytes32 digest = keccak256(abi.encodePacked(to, amount, nonce)).toEthSignedMessageHash();");
    expect(detectMissingDomainSeparation(checker).detected).toBe(true);
    expect(detectMissingDomainSeparation(prefixed).detected).toBe(true);
  });

  it("reports an EIP712Domain type that omits chainId or verifyingContract", () => {
    const code = `contract C {
  bytes32 constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,address verifyingContract)");
  function f(bytes32 structHash, bytes memory sig) external view {
    bytes32 digest = keccak256(abi.encodePacked("\\x19\\x01", DOMAIN_SEPARATOR, structHash));
    address signer = ECDSA.recover(digest, sig);
  }
}`;
    const result = detectMissingDomainSeparation(code);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toContain("EIP712Domain");
    expect(result.findings[0].message).toContain("omits chainId");
    expect(result.findings[0].line).toBe(2);
  });

  it("reports nothing for code without signature checks", () => {
    expect(detectMissingDomainSeparation("contract C { function f() external pure returns (uint256) { return 1; } }").detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function f() external { ecrecover(h, v, r, s);", "", "ecrecover(h, v, r, s);"]) {
      const result = detectMissingDomainSeparation(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
