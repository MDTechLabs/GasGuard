import { detectSignatureExpiryBoundary } from "../detect-signature-expiry-boundary";

const sigFn = (name: string, body: string, params = "uint256 deadline, bytes memory signature") => `
  function ${name}(${params}) external {
${body}
    address signer = ECDSA.recover(hash, signature);
  }`;
const contract = (...fns: string[]) => `pragma solidity ^0.8.20;
contract C {${fns.join("\n")}
}`;

describe("detectSignatureExpiryBoundary", () => {
  it("flags an inverted require as high severity", () => {
    const code = contract(sigFn("claim", `    require(block.timestamp >= deadline, "expired");`));
    const result = detectSignatureExpiryBoundary(code);
    expect(result.detected).toBe(true);
    const f = result.findings.find((x) => x.title.includes("inverted"))!;
    expect(f.severity).toBe("high");
    expect(f.message).toContain("block.timestamp >= deadline");
  });

  it("flags an inverted if-revert", () => {
    const code = contract(sigFn("claim", `    if (block.timestamp <= deadline) revert Expired();`));
    expect(detectSignatureExpiryBoundary(code).findings.some((f) => f.title.includes("inverted"))).toBe(true);
  });

  it("accepts the EIP-2612 inclusive convention and the exclusive convention on their own", () => {
    const inclusive = contract(sigFn("permit", `    require(block.timestamp <= deadline, "expired");`));
    const exclusive = contract(sigFn("permit", `    require(block.timestamp < deadline, "expired");`));
    expect(detectSignatureExpiryBoundary(inclusive).detected).toBe(false);
    expect(detectSignatureExpiryBoundary(exclusive).detected).toBe(false);
  });

  it("reports inconsistent boundaries across functions and what happens at exactly the deadline", () => {
    const code = contract(
      sigFn("permit", `    require(block.timestamp <= deadline);`),
      sigFn("executeOrder", `    require(block.timestamp < deadline);`),
    );
    const result = detectSignatureExpiryBoundary(code);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.functionName).toBe("executeOrder");
    expect(f.message).toContain("exclusive");
    expect(f.message).toContain("already expired at exactly the deadline");
  });

  it("applies an expected boundary from options or from a comment directive", () => {
    const code = contract(sigFn("permit", `    require(block.timestamp <= deadline);`));
    const viaOption = detectSignatureExpiryBoundary(code, { expectedBoundary: "exclusive" });
    expect(viaOption.findings[0].message).toContain("expected convention is exclusive");
    const viaComment = detectSignatureExpiryBoundary(`// deadline-boundary: exclusive\n${code}`);
    expect(viaComment.findings).toHaveLength(1);
    expect(detectSignatureExpiryBoundary(code, { expectedBoundary: "inclusive" }).detected).toBe(false);
  });

  it("flags an off-by-one adjustment of the deadline", () => {
    const code = contract(sigFn("claim", `    require(block.timestamp <= deadline + 1);`));
    const result = detectSignatureExpiryBoundary(code);
    expect(result.findings.some((f) => f.title.includes("adjusted") && f.message.includes("+1"))).toBe(true);
  });

  it("flags a signed deadline that is never validated", () => {
    const code = `contract C {
  function execute(address to, uint256 amount, uint256 deadline, bytes memory signature) external {
    bytes32 hash = keccak256(abi.encode(to, amount, deadline));
    address signer = ECDSA.recover(hash, signature);
  }
}`;
    const result = detectSignatureExpiryBoundary(code);
    expect(result.findings[0].title).toBe("Signed deadline is never validated");
    expect(result.findings[0].severity).toBe("high");
  });

  it("flags a checked deadline that is not part of the signed digest", () => {
    const code = `contract C {
  function execute(address to, uint256 amount, uint256 deadline, bytes memory signature) external {
    require(block.timestamp <= deadline);
    bytes32 hash = keccak256(abi.encode(to, amount));
    address signer = ECDSA.recover(hash, signature);
  }
}`;
    const result = detectSignatureExpiryBoundary(code);
    expect(result.findings.some((f) => f.title.includes("not part of the signed digest"))).toBe(true);
  });

  it("accepts a fully signed and checked deadline", () => {
    const code = `contract C {
  function permit(address owner, uint256 value, uint256 deadline, bytes memory signature) external {
    require(block.timestamp <= deadline, "expired");
    bytes32 hash = keccak256(abi.encode(owner, value, deadline));
    address signer = ECDSA.recover(hash, signature);
  }
}`;
    expect(detectSignatureExpiryBoundary(code).detected).toBe(false);
  });

  it("handles the zero-deadline sentinel: undocumented, documented, and documented-but-missing", () => {
    const body = `    require(deadline == 0 || block.timestamp <= deadline);`;
    const undocumented = detectSignatureExpiryBoundary(contract(sigFn("claim", body)));
    expect(undocumented.findings.map((f) => f.title)).toEqual(["Zero deadline sentinel is undocumented"]);
    expect(undocumented.findings[0].severity).toBe("low");
    const documented = detectSignatureExpiryBoundary(`// A deadline of 0 means no expiry.\n${contract(sigFn("claim", body))}`);
    expect(documented.detected).toBe(false);
    const missing = detectSignatureExpiryBoundary(`// A deadline of 0 means no expiry.\n${contract(sigFn("claim", `    require(block.timestamp <= deadline);`))}`);
    expect(missing.findings.map((f) => f.title)).toEqual(["Documented zero deadline sentinel is not implemented"]);
  });

  it("ignores deadline checks in functions that do not verify signatures", () => {
    const code = `contract C { function f(uint256 deadline) external view { require(block.timestamp >= deadline); } }`;
    expect(detectSignatureExpiryBoundary(code).detected).toBe(false);
  });

  it("fails safely on malformed or unsupported input", () => {
    for (const bad of ["contract A { function permit(uint256 deadline) external {", "", "require(block.timestamp <= deadline);"]) {
      const result = detectSignatureExpiryBoundary(bad);
      expect(result.detected).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
