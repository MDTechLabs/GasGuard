import { detectFlashLoanCallbackTrust } from "../detect-flash-loan-callback-trust";

describe("detectFlashLoanCallbackTrust", () => {
  it("flags a callback with no caller or initiator checks", () => {
    const code = `
contract Borrower {
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data) external returns (bytes32) {
        _arbitrage(token, amount);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}`;
    const titles = detectFlashLoanCallbackTrust(code).findings.map((f) => f.title);
    expect(titles).toContain("Flash-loan callback does not authenticate the caller");
    expect(titles).toContain("Flash-loan initiator is not validated");
  });

  it("accepts a callback that checks the lender and the initiator", () => {
    const code = `
contract Borrower {
    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data) external returns (bytes32) {
        require(msg.sender == lender, "untrusted lender");
        require(initiator == address(this), "untrusted initiator");
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}`;
    expect(detectFlashLoanCallbackTrust(code).detected).toBe(false);
  });

  it("fails safely on malformed source", () => {
    const result = detectFlashLoanCallbackTrust("contract B { function onFlashLoan(");
    expect(result.findings).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(true);
  });
});
