/** Solidity fixtures for GG-GAS-FORWARD-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Payer {
  address public owner;
  uint256 constant PAYOUT_GAS = 30000;
  mapping(address => uint256) public balances;
  mapping(address => uint256) public pending;
  address[] public winners;
`;

/** Pays a third party with transfer(): reverts if the recipient needs more than 2300 gas. */
export const TRANSFER_THIRD_PARTY = `${HEAD}
  function payout(address payable to, uint256 amt) external {
    require(msg.sender == owner);
    to.transfer(amt);
  }
}
`;

/** A user withdrawing to themselves: only they are affected. State is zeroed first. */
export const TRANSFER_SELF_EFFECTS_FIRST = `${HEAD}
  function withdraw() external {
    uint256 a = balances[msg.sender];
    balances[msg.sender] = 0;
    payable(msg.sender).transfer(a);
  }
}
`;

/** Interaction before effects: the state write happens after the call. */
export const TRANSFER_SELF_EFFECTS_AFTER = `${HEAD}
  function withdraw() external {
    uint256 a = balances[msg.sender];
    payable(msg.sender).transfer(a);
    balances[msg.sender] = 0;
  }
}
`;

/** One bad recipient blocks the whole distribution. */
export const TRANSFER_IN_LOOP = `${HEAD}
  function distribute(uint256 prize) external {
    for (uint256 i = 0; i < winners.length; i++) {
      payable(winners[i]).transfer(prize);
    }
  }
}
`;

/** send() result ignored after the books were already updated. */
export const SEND_UNCHECKED = `${HEAD}
  function refund(address payable to, uint256 amt) external {
    balances[to] -= amt;
    to.send(amt);
  }
}
`;

export const SEND_REQUIRED = `${HEAD}
  function refund(address payable to, uint256 amt) external {
    require(to.send(amt), "send failed");
  }
}
`;

/** send() failure is handled without reverting. */
export const SEND_HANDLED = `${HEAD}
  function refund(address payable to, uint256 amt) external {
    if (!to.send(amt)) {
      pending[to] += amt;
    }
  }
}
`;

/** A literal gas ceiling with revert-on-failure. */
export const CALL_LITERAL_GAS_REVERTS = `${HEAD}
  function pay(address to, uint256 amt) external {
    (bool ok, ) = to.call{gas: 2300, value: amt}("");
    require(ok, "pay failed");
  }
}
`;

/** A gas ceiling whose result is ignored. */
export const CALL_LITERAL_GAS_UNCHECKED = `${HEAD}
  function pay(address to, uint256 amt) external {
    to.call{gas: 5000, value: amt}("");
  }
}
`;

/** Deliberate cap: named constant, failure credited to a pull-payment balance. */
export const INTENTIONAL_CAP = `${HEAD}
  function pay(address to, uint256 amt) external {
    (bool ok, ) = to.call{gas: PAYOUT_GAS, value: amt}("");
    if (!ok) {
      pending[to] += amt;
    }
  }
}
`;

/** All remaining gas is forwarded: not a gas-forwarding assumption. */
export const CALL_NO_CAP = `${HEAD}
  function pay(address to, uint256 amt) external {
    (bool ok, ) = to.call{value: amt}("");
    require(ok, "pay failed");
  }
}
`;

/** ERC-20 transfer(to, amount) is not an address transfer. */
export const ERC20_TRANSFER = `${HEAD}
  function pay(IERC20 token, address to, uint256 amt) external {
    token.transfer(to, amt);
  }
}
`;

/** Pre-0.7 syntax. */
export const LEGACY_CALL_GAS = `
pragma solidity ^0.6.12;
contract Payer {
  function pay(address to, uint256 amt) external {
    (bool ok, ) = to.call.gas(2300).value(amt)("");
    require(ok);
  }
}
`;

/** Gas computed at run time. */
export const DYNAMIC_GAS = `${HEAD}
  function pay(address to, uint256 amt) external {
    (bool ok, ) = to.call{gas: gasleft() - 1000, value: amt}("");
    require(ok, "pay failed");
  }
}
`;

/**
 * Recipient fallback fixtures with varying gas requirements. The gas figures are
 * approximate post-Istanbul costs and are documentation, not measurements.
 */
export const RECIPIENTS = {
  /** Emits an event only: fits inside the 2300 stipend. */
  emitOnly: {
    approxGasNeeded: 1_500,
    source: `
pragma solidity ^0.8.20;
contract EmitOnlyRecipient {
  event Received(uint256 amount);
  receive() external payable { emit Received(msg.value); }
}`,
  },
  /** Writes one storage slot: SSTORE alone exceeds 2300. */
  storageWrite: {
    approxGasNeeded: 22_000,
    source: `
pragma solidity ^0.8.20;
contract StorageRecipient {
  uint256 public received;
  receive() external payable { received += msg.value; }
}`,
  },
  /** Forwards to another contract (e.g. a proxy or multisig): needs far more than 2300. */
  forwarder: {
    approxGasNeeded: 30_000,
    source: `
pragma solidity ^0.8.20;
contract ForwardingRecipient {
  address public target;
  receive() external payable { (bool ok, ) = target.call{value: msg.value}(""); require(ok); }
}`,
  },
};
