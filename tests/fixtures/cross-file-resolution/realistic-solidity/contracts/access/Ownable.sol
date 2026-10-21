// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

error NotOwner(address caller);

abstract contract Ownable {
    address public owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }
}
