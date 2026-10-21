// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@gasguard/access/Ownable.sol";
import {IERC20 as Token} from "./interfaces/IERC20.sol";
import {SafeTransfer} from "./libraries/SafeTransfer.sol";
import "./Errors.sol" as Errors;
import {ReentrancyGuard} from "@openzeppelin/security/ReentrancyGuard.sol";

// SafeTransfer is mentioned here only in a comment and must not count.
contract Vault is Ownable, ReentrancyGuard {
    using SafeTransfer for Token;

    string public constant LABEL = "Ownable Vault";

    function withdraw(Token token, uint256 amount) external onlyOwner {
        if (amount == 0) revert Errors.ZeroAmount();
        SafeTransfer.safeTransfer(token, msg.sender, amount);
    }
}
