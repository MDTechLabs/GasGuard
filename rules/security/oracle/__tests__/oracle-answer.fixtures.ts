/** Solidity fixtures for GG-ORACLE-ANSWER-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Lender {
  uint256 constant HEARTBEAT = 3600;
  uint256 constant MAX_AGE = 3600;
  event Seen(int256 answer);
  IFeed public feed;
  IFeed public sequencerUptimeFeed;
  IOracle public oracle;
`;

/** Nothing is validated: zero, negative, incomplete and stale answers all pass. */
export const NO_CHECKS = `${HEAD}
  function price() external view returns (uint256) {
    (, int256 answer, , , ) = feed.latestRoundData();
    return uint256(answer) * 1e10;
  }
}
`;

/** Sign and round are checked; the answer may be stale. */
export const STALE_ANSWER = `${HEAD}
  function price() external view returns (uint256) {
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
    require(answer > 0, "bad");
    require(answeredInRound >= roundId, "incomplete");
    return uint256(answer);
  }
}
`;

/** Sign and freshness are checked; an incomplete round may be returned. */
export const INCOMPLETE_ROUND = `${HEAD}
  function price() external view returns (uint256) {
    (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
    require(answer > 0, "bad");
    require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
    return uint256(answer);
  }
}
`;

/** `>= 0` still accepts a zero answer. */
export const ZERO_ANSWER_ALLOWED = `${HEAD}
  function price() external view returns (uint256) {
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
    require(answer >= 0, "negative");
    require(answeredInRound >= roundId, "incomplete");
    require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
    return uint256(answer);
  }
}
`;

/** `!= 0` still accepts a negative answer. */
export const NEGATIVE_ANSWER_ALLOWED = `${HEAD}
  function price() external view returns (uint256) {
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
    require(answer != 0, "zero");
    require(answeredInRound >= roundId, "incomplete");
    require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
    return uint256(answer);
  }
}
`;

export const SAFE_FULL_VALIDATION = `${HEAD}
  function price() external view returns (uint256) {
    (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
    require(answer > 0, "bad");
    require(answeredInRound >= roundId, "incomplete");
    require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
    return uint256(answer);
  }
}
`;

/** Alternative idioms: revert-style sign, updatedAt zero check, additive staleness. */
export const SAFE_ALTERNATIVE_IDIOMS = `${HEAD}
  function price() external view returns (uint256) {
    (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
    if (answer <= 0) revert();
    if (updatedAt == 0) revert();
    if (block.timestamp > updatedAt + MAX_AGE) revert();
    return uint256(answer);
  }
}
`;

/** Sequencer uptime feed: the answer is up/down, not a price. */
export const SEQUENCER_FEED = `${HEAD}
  function sequencerUp() public view returns (bool) {
    (, int256 answer, uint256 startedAt, , ) = sequencerUptimeFeed.latestRoundData();
    bool isUp = answer == 0;
    return isUp && block.timestamp - startedAt > 3600;
  }
}
`;

/** The answer is only emitted, never used in financial logic. */
export const NOT_FINANCIAL_USE = `${HEAD}
  function observe() external {
    (, int256 answer, , , ) = feed.latestRoundData();
    emit Seen(answer);
  }
}
`;

export const DEPRECATED_LATEST_ANSWER = `${HEAD}
  function price() external view returns (uint256) {
    int256 p = feed.latestAnswer();
    return uint256(p);
  }
}
`;

export const UNVALIDATED_ADAPTER = `${HEAD}
  function value(address token, uint256 qty) external view returns (uint256) {
    uint256 p = oracle.getPrice(token);
    return p * qty;
  }
}
`;

export const VALIDATED_ADAPTER = `${HEAD}
  function value(address token, uint256 qty) external view returns (uint256) {
    uint256 p = oracle.getPrice(token);
    require(p > 0, "no price");
    return p * qty;
  }
}
`;

/** Adapter with a non-standard method name, configured by option. */
export const CUSTOM_ADAPTER_METHOD = `${HEAD}
  function value(address token, uint256 qty) external view returns (uint256) {
    uint256 p = oracle.priceOf(token);
    return p * qty;
  }
}
`;
