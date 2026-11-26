import { detectOverloadAccessControl } from "../detect-overload-access-control";

describe("detectOverloadAccessControl", () => {
  it("flags an unprotected overload next to a protected one", () => {
    const code = `
contract Treasury {
    function withdraw(uint256 amount) external onlyOwner { _send(msg.sender, amount); }
    function withdraw(uint256 amount, address to) external { _send(to, amount); }
}`;
    const result = detectOverloadAccessControl(code);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].line).toBe(4);
  });

  it("accepts consistent protection and forwarding overloads", () => {
    const code = `
contract Treasury {
    function withdraw(uint256 amount, address to) external onlyOwner { _send(to, amount); }
    function withdraw(uint256 amount) external { withdraw(amount, msg.sender); }
}`;
    expect(detectOverloadAccessControl(code).detected).toBe(false);
  });

  it("fails safely on malformed source", () => {
    const result = detectOverloadAccessControl("contract T { function a( external {");
    expect(result.findings).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(true);
  });
});
