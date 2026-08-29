// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GuardedVault
/// @notice Fixture contract used by `transformers::transient_lock` tests
/// and the CLI's manual QA. `_locked` is a pure intra-transaction
/// reentrancy-guard flag — checked, set, and cleared entirely within
/// `nonReentrant`, never read elsewhere — so Rule G020 should convert it
/// from a persistent storage slot to EIP-1153 transient storage.
contract GuardedVault {
    bool private _locked;

    mapping(address => uint256) public balances;

    modifier nonReentrant() {
        require(!_locked, "ReentrancyGuard: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "insufficient balance");
        balances[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }
}
