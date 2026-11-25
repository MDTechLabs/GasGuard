import { detectTimelockUpgradeBypass } from "./timelock-upgrade-bypass-detector";

describe("sol-027 timelock upgrade bypass detector", () => {
  it("detects direct owner upgrade bypass in a timelocked contract", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TimelockedVaultUpgrade {
    address public timelock;
    address public implementation;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function scheduleUpgrade(address newImpl) external {
        require(msg.sender == timelock, "only timelock");
    }

    // Vulnerable bypass: direct upgrade callable by owner without timelock delay
    function upgradeTo(address newImpl) external onlyOwner {
        implementation = newImpl;
    }
}
`;
    const detection = detectTimelockUpgradeBypass(code);
    expect(detection.findings).toHaveLength(1);
    expect(detection.findings[0].kind).toBe("direct-admin-upgrade");
    expect(detection.findings[0].functionName).toBe("upgradeTo");
  });

  it("detects emergency upgrade bypass functions", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ManagedProtocol {
    address public timelock;
    address public implementation;

    function emergencyUpgrade(address instantImpl) external {
        implementation = instantImpl;
    }
}
`;
    const detection = detectTimelockUpgradeBypass(code);
    const finding = detection.findings.find(
      (f) => f.kind === "emergency-upgrade-bypass",
    );
    expect(finding).toBeDefined();
    expect(finding?.functionName).toBe("emergencyUpgrade");
  });

  it("detects unprotected delay setter and unbounded zero delay", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GovernanceModule {
    uint256 public delay = 2 days;
    address public admin;

    function setDelay(uint256 newDelay) external {
        require(msg.sender == admin, "only admin");
        delay = newDelay;
    }
}
`;
    const detection = detectTimelockUpgradeBypass(code);
    expect(
      detection.findings.some((f) => f.kind === "unprotected-delay-setter"),
    ).toBe(true);
    expect(
      detection.findings.some((f) => f.kind === "unbounded-zero-delay"),
    ).toBe(true);
  });

  it("does not report properly enforced timelock upgrades and delay setters", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SecureTimelockedProxy {
    address public timelock;
    address public implementation;
    uint256 public delay = 2 days;
    uint256 public constant MIN_DELAY = 1 days;

    modifier onlyTimelock() {
        require(msg.sender == timelock, "only timelock");
        _;
    }

    function upgradeTo(address newImpl) external onlyTimelock {
        implementation = newImpl;
    }

    function setDelay(uint256 newDelay) external onlyTimelock {
        require(newDelay >= MIN_DELAY, "delay too short");
        delay = newDelay;
    }
}
`;
    const detection = detectTimelockUpgradeBypass(code);
    expect(detection.findings).toHaveLength(0);
    expect(detection.diagnostics).toHaveLength(0);
  });

  it("does not report when upgrade checks operation readiness in timelock", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ScheduledUpgrades {
    address public timelock;
    address public implementation;
    mapping(bytes32 => uint256) public pendingUpgrade;

    function executeUpgrade(bytes32 opId, address newImpl) external {
        require(isOperationReady(opId), "not ready");
        implementation = newImpl;
    }

    function isOperationReady(bytes32 opId) public view returns (bool) {
        return block.timestamp >= pendingUpgrade[opId];
    }
}
`;
    const detection = detectTimelockUpgradeBypass(code);
    expect(detection.findings).toHaveLength(0);
  });

  it("handles malformed source safely without crashing", () => {
    const badInput = "contract Broken { /* unterminated comment";
    const result = detectTimelockUpgradeBypass(badInput);
    expect(result.findings).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("handles non-string input safely", () => {
    const result = detectTimelockUpgradeBypass(12345);
    expect(result.findings).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
  });
});
