// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SystemConfig
/// @notice Reference config contract using `immutable` for values set once at
///         deployment, avoiding a 2,100 gas cold SLOAD on every read.
contract SystemConfig {
    address public immutable factory;
    address public immutable weth;
    address public immutable tokenVault;

    constructor(address factory_, address weth_, address tokenVault_) {
        factory = factory_;
        weth = weth_;
        tokenVault = tokenVault_;
    }
}
