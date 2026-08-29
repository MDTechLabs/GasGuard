// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title NonStandardERC20
/// @notice Mimics USDT-on-mainnet's well-known non-standard behavior:
///         `transfer`/`transferFrom` declare no return value at all, so a
///         successful call produces zero returndata. Used to exercise the
///         `returndatasize == 0 -> success` branch of `YulSafeTransfer`.
contract NonStandardERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    // Intentionally no return type, matching USDT's actual ABI.
    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "NonStandardERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    // Intentionally no return type, matching USDT's actual ABI.
    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "NonStandardERC20: insufficient allowance");
        require(balanceOf[from] >= amount, "NonStandardERC20: insufficient balance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
