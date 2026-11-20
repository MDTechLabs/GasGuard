/** Solidity fixtures for GG-ORACLE-DECIMALS-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Pricing {
  uint8 constant COLLATERAL_DECIMALS = 8;
  uint8 constant STABLE_DECIMALS = 18;
  uint8 constant ETH_USD_DECIMALS = 8;
  uint8 constant TOKEN_ETH_DECIMALS = 18;
  IFeed public collateralFeed;
  IFeed public stableFeed;
  IFeed public ethUsdFeed;
  IFeed public tokenEthFeed;
  IFeed public feedA;
  IFeed public feedB;
`;

/** Collateral (8 decimals) divided by a stable price (18 decimals), no rescaling. */
export const STABLECOIN_COLLATERAL_UNNORMALIZED = `${HEAD}
  function collateralValue(uint256 amount) external view returns (uint256) {
    (, int256 cp, , , ) = collateralFeed.latestRoundData();
    (, int256 sp, , , ) = stableFeed.latestRoundData();
    return amount * uint256(cp) / uint256(sp);
  }
}
`;

/** token/ETH (18 decimals) times ETH/USD (8 decimals). */
export const CROSS_RATE_UNNORMALIZED = `${HEAD}
  function tokenUsd() external view returns (uint256) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    (, int256 b, , , ) = tokenEthFeed.latestRoundData();
    return uint256(a) * uint256(b);
  }
}
`;

/** Each feed is rescaled using its own decimals() before the calculation. */
export const SAFE_DECIMALS_QUERIED = `${HEAD}
  function ratio() external view returns (uint256) {
    (, int256 a, , , ) = feedA.latestRoundData();
    (, int256 b, , , ) = feedB.latestRoundData();
    uint8 dA = feedA.decimals();
    uint8 dB = feedB.decimals();
    uint256 pA = uint256(a) * 10 ** (18 - dA);
    uint256 pB = uint256(b) * 10 ** (18 - dB);
    return pA * 1e18 / pB;
  }
}
`;

/** Only feed A is rescaled. */
export const PARTIAL_NORMALIZATION = `${HEAD}
  function ratio() external view returns (uint256) {
    (, int256 a, , , ) = feedA.latestRoundData();
    (, int256 b, , , ) = feedB.latestRoundData();
    uint8 dA = feedA.decimals();
    uint256 pA = uint256(a) * 10 ** (18 - dA);
    uint256 pB = uint256(b);
    return pA * pB;
  }
}
`;

/** Two 8-decimal feeds in a pure ratio: the scales cancel. */
export const SAME_DECIMALS_RATIO = `${HEAD}
  function ratio() external view returns (uint256) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    (, int256 b, , , ) = collateralFeed.latestRoundData();
    return uint256(a) / uint256(b);
  }
}
`;

/** decimals() is queried but the result is never applied. */
export const DECIMALS_QUERIED_UNUSED = `${HEAD}
  function product() external view returns (uint256) {
    (, int256 a, , , ) = feedA.latestRoundData();
    (, int256 b, , , ) = feedB.latestRoundData();
    uint8 dA = feedA.decimals();
    return uint256(a) * uint256(b);
  }
}
`;

/** A literal scale factor with feeds of known, different decimals (advisory). */
export const LITERAL_SCALE_MIXED = `${HEAD}
  function tokenUsd() external view returns (uint256) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    (, int256 b, , , ) = tokenEthFeed.latestRoundData();
    return uint256(a) * uint256(b) / 1e8;
  }
}
`;

/** A single feed combined with an amount is not a multi-feed calculation. */
export const SINGLE_FEED = `${HEAD}
  function value(uint256 amount) external view returns (uint256) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    return amount * uint256(a) / 1e8;
  }
}
`;
