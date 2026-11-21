// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

// ---- Token behaviours the callers below must cope with ----

contract TrueToken {
    function approve(address, uint256) external pure returns (bool) { return true; }
}

contract FalseToken {
    function approve(address, uint256) external pure returns (bool) { return false; }
}

contract NoReturnToken {
    function approve(address, uint256) external {}
}

contract RevertingToken {
    function approve(address, uint256) external pure returns (bool) { revert("blocked"); }
}

contract MalformedReturnToken {
    fallback() external {
        assembly { mstore(0, 1) return(0, 1) }
    }
}

// ---- Callers ----

contract Callers {
    using SafeERC20 for IERC20;

    function discarded(address token, address spender, uint256 amount) external {
        IERC20(token).approve(spender, amount);
    }

    function discardedViaLocal(IERC20 token, address spender, uint256 amount) external {
        bool ok = token.approve(spender, amount);
    }

    function assumesBool(IERC20 token, address spender, uint256 amount) external {
        require(token.approve(spender, amount), "approve failed");
    }

    function lowLevelDiscarded(address token, address spender, uint256 amount) external {
        token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
    }

    function lowLevelUnchecked(address token, address spender, uint256 amount) external {
        (bool success, ) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
    }

    function lowLevelFalseTreatedAsSuccess(address token, address spender, uint256 amount) external {
        (bool success, ) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(success, "approve reverted");
    }

    function lowLevelDecodeOnly(address token, address spender, uint256 amount) external {
        (bool success, bytes memory data) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, amount));
        require(success && abi.decode(data, (bool)), "approve failed");
    }

    // ---- Safe patterns: must not be reported ----

    function lowLevelTolerant(address token, address spender, uint256 amount) external {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "approve failed");
    }

    function wrapped(IERC20 token, address spender, uint256 amount) external {
        token.safeApprove(spender, amount);
    }

    function ownApprove(address spender, uint256 amount) external {
        this.approve(spender, amount);
    }

    function approve(address, uint256) external pure returns (bool) { return true; }
}
