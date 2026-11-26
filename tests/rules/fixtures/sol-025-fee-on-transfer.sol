// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IStrategy {
    function withdraw(uint256 amount) external;
}

contract NaiveVault {
    IERC20 public token;
    mapping(address => uint256) public balances;
    uint256 public totalAssets;

    function deposit(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        totalAssets += amount;
    }
}

/// @notice Vault that supports fee-on-transfer tokens.
contract ClaimedSupportVault {
    IERC20 public token;
    mapping(address => uint256) public shares;
    uint256 public totalShares;

    function deposit(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        shares[msg.sender] += amount;
        totalShares += amount;
    }
}

/// @notice Handles fee-on-transfer tokens by crediting the measured balance delta.
contract DeltaVault {
    IERC20 public token;
    mapping(address => uint256) public balances;

    function deposit(uint256 amount) external {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.transferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        balances[msg.sender] += received;
    }
}

/// @notice Fee-on-transfer tokens are not supported; only standard ERC-20 tokens may be listed.
contract StrictVault {
    IERC20 public token;
    mapping(address => uint256) public balances;

    function deposit(uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
    }
}

contract NaivePool {
    IERC20 public token0;
    IERC20 public token1;
    uint256 public reserve0;
    uint256 public reserve1;

    function addLiquidity(uint256 amount0, uint256 amount1) external {
        token0.transferFrom(msg.sender, address(this), amount0);
        token1.transferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
    }
}

contract NaiveSwap {
    IERC20 public tokenIn;
    IERC20 public tokenOut;
    uint256 public reserveIn;
    uint256 public reserveOut;

    function swap(uint256 amountIn) external {
        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * reserveOut) / (reserveIn + amountIn);
        reserveIn += amountIn;
        reserveOut -= amountOut;
        tokenOut.transfer(msg.sender, amountOut);
    }
}

contract DeltaSwap {
    IERC20 public tokenIn;
    IERC20 public tokenOut;
    uint256 public reserveIn;
    uint256 public reserveOut;

    function swap(uint256 amountIn) external {
        uint256 balanceBefore = tokenIn.balanceOf(address(this));
        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        uint256 received = tokenIn.balanceOf(address(this)) - balanceBefore;
        uint256 amountOut = (received * reserveOut) / (reserveIn + received);
        reserveIn += received;
        reserveOut -= amountOut;
        tokenOut.transfer(msg.sender, amountOut);
    }
}

contract ForwardingVault {
    IERC20 public token;
    IStrategy public strategy;

    function withdraw(uint256 amount) external {
        strategy.withdraw(amount);
        token.transfer(msg.sender, amount);
    }
}

contract DeltaForwardingVault {
    IERC20 public token;
    IStrategy public strategy;

    function withdraw(uint256 amount) external {
        uint256 beforeBalance = token.balanceOf(address(this));
        strategy.withdraw(amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        token.transfer(msg.sender, received);
    }
}

contract SharesVault {
    IERC20 public token;
    mapping(address => uint256) public balances;

    function withdraw(uint256 amount) external {
        balances[msg.sender] -= amount;
        token.transfer(msg.sender, amount);
    }
}
