// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Deposits are tracked per account { see Token.sol }.
contract Vault {
    mapping(address => uint256) public deposits;

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
    }
}
