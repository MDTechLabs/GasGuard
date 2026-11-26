import { detectBeaconProxyHazards } from "./beacon-proxy-hazard-detector";

describe("sol-028 beacon proxy hazards detector", () => {
  it("detects uninitialized beacon proxy deployment with empty calldata", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ProxyFactory {
    function deployProxy(address beacon) external returns (address) {
        return address(new BeaconProxy(beacon, ""));
    }
}
`;
    const detection = detectBeaconProxyHazards(code);
    expect(
      detection.findings.some(
        (f) => f.kind === "uninitialized-proxy-deployment",
      ),
    ).toBe(true);
    expect(
      detection.findings.some((f) => f.kind === "unvalidated-beacon-address"),
    ).toBe(true);
  });

  it("detects unprotected upgradeTo in UpgradeableBeacon", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CustomUpgradeableBeacon {
    address private _implementation;

    function upgradeTo(address newImplementation) external {
        _implementation = newImplementation;
    }
}
`;
    const detection = detectBeaconProxyHazards(code);
    expect(
      detection.findings.some((f) => f.kind === "unprotected-beacon-upgrade"),
    ).toBe(true);
    expect(
      detection.findings.some((f) => f.kind === "empty-implementation-upgrade"),
    ).toBe(true);
  });

  it("detects missing _disableInitializers in upgradeable logic constructor", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract LogicV1 is Initializable {
    uint256 public value;

    constructor() {}

    function initialize(uint256 val) external initializer {
        value = val;
    }
}
`;
    const detection = detectBeaconProxyHazards(code);
    expect(
      detection.findings.some((f) => f.kind === "missing-initializer-disable"),
    ).toBe(true);
  });

  it("does not flag properly protected beacon proxies, upgrades, and implementations", () => {
    const code = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract SafeLogicV1 is Initializable {
    uint256 public value;

    constructor() {
        _disableInitializers();
    }

    function initialize(uint256 val) external initializer {
        value = val;
    }
}

contract SafeUpgradeableBeacon {
    address private _implementation;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function upgradeTo(address newImplementation) external onlyOwner {
        require(newImplementation.code.length > 0, "not a contract");
        _implementation = newImplementation;
    }
}

contract SafeProxyFactory {
    function deployProxy(address beacon, uint256 val) external returns (address) {
        require(beacon.code.length > 0, "invalid beacon");
        bytes memory initData = abi.encodeWithSelector(SafeLogicV1.initialize.selector, val);
        return address(new BeaconProxy(beacon, initData));
    }
}
`;
    const detection = detectBeaconProxyHazards(code);
    expect(detection.findings).toHaveLength(0);
    expect(detection.diagnostics).toHaveLength(0);
  });

  it("handles malformed source and non-string inputs safely", () => {
    const badInput = "contract Incomplete { /* unclosed comment";
    const res = detectBeaconProxyHazards(badInput);
    expect(res.findings).toHaveLength(0);
    expect(res.diagnostics).toHaveLength(1);

    const nonString = detectBeaconProxyHazards(999);
    expect(nonString.findings).toHaveLength(0);
    expect(nonString.diagnostics).toHaveLength(1);
  });
});
