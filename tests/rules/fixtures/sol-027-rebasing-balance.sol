// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// Positive: a stored deposit is later paid out as the nominal amount.
contract Staking {
    IERC20 public token;
    mapping(address => uint256) public deposits;

    function deposit(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "bal");
        deposits[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
    }
}

// Positive: a balance snapshot is later paid out.
contract Escrow {
    IERC20 public asset;
    uint256 public locked;

    function lock() external { locked = asset.balanceOf(address(this)); }

    function release(address to) external { asset.transfer(to, locked); }
}

// Negative: share-based accounting paid from the live balance.
contract SharesVault {
    IERC20 public token;
    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    function deposit(uint256 amount) external {
        uint256 shares = amount * totalShares / token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        sharesOf[msg.sender] += shares;
        totalShares += shares;
    }

    function withdraw(uint256 shares) external {
        sharesOf[msg.sender] -= shares;
        token.safeTransfer(msg.sender, shares * token.balanceOf(address(this)) / totalShares);
    }
}

// Negative: the same flow as Staking with an explicit exclusion.
contract ExcludedStaking {
    // Rebasing tokens are not supported.
    IERC20 public token;
    mapping(address => uint256) public deposits;

    function deposit(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "bal");
        deposits[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
    }
}
