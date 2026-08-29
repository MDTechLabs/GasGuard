// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title G011 Sample Contracts
/// @notice Test fixtures for Rule G011: Detect Unused State Variable Declarations.

contract UnusedStateVariables {
    uint256 public usedVar;
    uint256 public unusedVar;
    bool public activeFlag;
    bool public neverRead;
    mapping(address => uint256) public balances;
    uint256 public neverWritten;

    function setUsedVar(uint256 value) external {
        usedVar = value;
    }

    function getUsedVar() external view returns (uint256) {
        return usedVar;
    }

    function setFlag(bool _active) external {
        activeFlag = _active;
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}

contract AllVariablesUsed {
    uint256 public counter;
    bool public enabled;
    address public owner;

    function increment() external {
        counter += 1;
    }

    function toggle() external {
        enabled = !enabled;
    }

    function transferOwnership(address newOwner) external {
        owner = newOwner;
    }
}

contract MixedUsage {
    uint256 public used;
    uint256 public unused1;
    uint256 public unused2;
    bool public flag;

    function doSomething() external {
        used = 42;
        flag = true;
    }

    function getUsed() external view returns (uint256) {
        return used;
    }
}