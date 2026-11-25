import { detectTokenTransferWrapperReturns } from "./token-transfer-wrapper-detector";

describe("sol-029 token transfer wrapper returns detector", () => {
  it("detects high-level transfer assuming boolean return", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract PaymentProcessor {
    IERC20 public token;

    function pay(address to, uint256 amount) external {
        bool success = token.transfer(to, amount);
        require(success, "failed");
    }
}
`;
    const detection = detectTokenTransferWrapperReturns(code);
    expect(
      detection.findings.some((f) => f.kind === "assumes-bool-return"),
    ).toBe(true);
  });

  it("detects unchecked return value from direct transfer statement", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract Vault {
    IERC20 public token;

    function withdraw(address to, uint256 amount) external {
        token.transfer(to, amount);
    }
}
`;
    const detection = detectTokenTransferWrapperReturns(code);
    expect(
      detection.findings.some((f) => f.kind === "unchecked-boolean-return"),
    ).toBe(true);
  });

  it("detects custom low-level call wrapper that decodes without checking data length", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CustomTransferLib {
    function doTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        require(success, "call failed");
        bool transferred = abi.decode(data, (bool));
        require(transferred, "transfer failed");
    }
}
`;
    const detection = detectTokenTransferWrapperReturns(code);
    expect(
      detection.findings.some((f) => f.kind === "decode-without-length-check"),
    ).toBe(true);
  });

  it("does not report safe transfer wrappers using SafeERC20 or length checks", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SafeVault {
    using SafeERC20 for IERC20;
    IERC20 public token;

    function withdraw(address to, uint256 amount) external {
        token.safeTransfer(to, amount);
    }

    function customSafeTransfer(address tokenAddr, address to, uint256 amount) internal {
        (bool success, bytes memory data) = tokenAddr.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }
}
`;
    const detection = detectTokenTransferWrapperReturns(code);
    expect(detection.findings).toHaveLength(0);
    expect(detection.diagnostics).toHaveLength(0);
  });

  it("handles malformed source and non-string inputs safely", () => {
    const badInput = "contract Incomplete { /* unclosed comment";
    const res = detectTokenTransferWrapperReturns(badInput);
    expect(res.findings).toHaveLength(0);
    expect(res.diagnostics).toHaveLength(1);

    const nonString = detectTokenTransferWrapperReturns(null);
    expect(nonString.findings).toHaveLength(0);
    expect(nonString.diagnostics).toHaveLength(1);
  });
});
