// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Interface-only: nothing in this source shows how a token implements these.
interface IAdjustable {
    function increaseAllowance(address spender, uint256 added) external returns (bool);
    function decreaseAllowance(address spender, uint256 subtracted) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

// ---- Standard token: checked decrease, atomic in-token adjustment ----
contract StandardToken {
    mapping(address => mapping(address => uint256)) private _allowances;

    function increaseAllowance(address spender, uint256 added) external returns (bool) {
        _allowances[msg.sender][spender] += added;
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtracted) external returns (bool) {
        uint256 current = _allowances[msg.sender][spender];
        require(current >= subtracted, "decreased below zero");
        _allowances[msg.sender][spender] = current - subtracted;
        return true;
    }
}

// ---- Non-standard token: wraps on excessive decrease ----
contract WrappingToken {
    mapping(address => mapping(address => uint256)) public allowances;

    function shrink(address spender, uint256 amount) external {
        unchecked {
            allowances[msg.sender][spender] = allowances[msg.sender][spender] - amount;
        }
    }
}

// ---- Custom token: clamps to zero instead of reverting ----
contract ClampingToken {
    mapping(address => mapping(address => uint256)) public allowances;

    function trim(address spender, uint256 amount) external {
        uint256 current = allowances[msg.sender][spender];
        allowances[msg.sender][spender] = amount > current ? 0 : current - amount;
    }
}

// ---- Callers ----
contract Callers {
    function dropsResult(IAdjustable token, address spender, uint256 added) external {
        token.increaseAllowance(spender, added);
    }

    function assumesMethodExists(IAdjustable token, address spender, uint256 subtracted) external {
        require(token.decreaseAllowance(spender, subtracted), "decrease failed");
    }

    function inlineReadModifyWrite(IAdjustable token, address spender, uint256 added) external {
        token.approve(spender, token.allowance(address(this), spender) + added);
    }

    function variableReadModifyWrite(IAdjustable token, address spender, uint256 added) external {
        uint256 current = token.allowance(address(this), spender);
        token.approve(spender, current + added);
    }

    // ---- Safe patterns: must not be reported ----

    function setExact(IAdjustable token, address spender, uint256 amount) external {
        require(token.approve(spender, amount), "approve failed");
    }

    function readOnly(IAdjustable token, address spender) external view returns (uint256) {
        return token.allowance(address(this), spender);
    }

    // StandardToken's implementation is in this source and is checked above.
    function viaModeledToken(StandardToken token, address spender, uint256 added) external {
        token.increaseAllowance(spender, added);
    }

    function selfCall(address spender, uint256 added) external {
        this.increaseAllowance(spender, added);
    }

    function increaseAllowance(address, uint256) external pure returns (bool) { return true; }
}
