import { detectEip1967SlotUsage } from "../detect-eip1967-slot-usage";

const IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

describe("detectEip1967SlotUsage", () => {
  it("accepts the standard slots", () => {
    const code = `
contract P {
    bytes32 private constant _IMPLEMENTATION_SLOT = ${IMPL};
    bytes32 private constant _ADMIN_SLOT = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1);
}`;
    expect(detectEip1967SlotUsage(code).detected).toBe(false);
  });

  it("flags a missing minus one and swapped slots", () => {
    const code = `
contract P {
    bytes32 constant IMPLEMENTATION_SLOT = keccak256("eip1967.proxy.implementation");
    bytes32 constant ADMIN_SLOT = ${IMPL};
}`;
    const titles = detectEip1967SlotUsage(code).findings.map((f) => f.title);
    expect(titles).toContain("EIP-1967 slot missing the minus one offset");
    expect(titles).toContain("Implementation and admin slots swapped");
  });

  it("flags a plain implementation variable in a delegatecall proxy", () => {
    const code = `
contract P {
    address public implementation;
    fallback() external payable { implementation.delegatecall(msg.data); }
}`;
    const result = detectEip1967SlotUsage(code);
    expect(result.findings[0].line).toBe(3);
  });

  it("fails safely on malformed source", () => {
    expect(detectEip1967SlotUsage("contract P { bytes32 x = ").findings).toHaveLength(0);
  });
});
