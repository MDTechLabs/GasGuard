// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IToken {
    function transfer(address to, uint256 amount) external returns (bool);
}

contract Token is IToken {
    mapping(address => uint256) public balances;

    event Moved(address indexed from, address indexed to);

    function transfer(address to, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Moved(msg.sender, to);
        return true;
    }
}
