/** Solidity fixtures for GG-ORACLE-FALLBACK-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Pricing {
  uint256 constant HEARTBEAT = 3600;
  uint256 constant FALLBACK_HEARTBEAT = 86400;
  IFeed public primaryFeed;
  IFeed public fallbackFeed;
  IFeed public ethUsdFeed;
  IFeed public usdEthFeed;
  IFeed public ethEurFeed;
  IFeed public ethUsdBackupFeed;
  function _toWad(IFeed f, int256 v) internal view returns (uint256) {
    return uint256(v) * 10 ** (18 - f.decimals());
  }
`;

/** Primary rejects stale answers; the catch-path fallback accepts any age. */
export const STALE_POLICY_MISMATCH = `${HEAD}
  function price() public view returns (uint256 p) {
    try primaryFeed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
      require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
      p = uint256(answer);
    } catch {
      (, int256 a2, , , ) = fallbackFeed.latestRoundData();
      p = uint256(a2);
    }
  }
}
`;

/** Primary rescales by decimals(); the fallback uses the raw feed value. */
export const DECIMALS_MISMATCH = `${HEAD}
  function price() public view returns (uint256) {
    (, int256 a, , uint256 u, ) = primaryFeed.latestRoundData();
    uint256 p = uint256(a) * 10 ** (18 - primaryFeed.decimals());
    if (block.timestamp - u > HEARTBEAT) {
      (, int256 b, , uint256 u2, ) = fallbackFeed.latestRoundData();
      require(block.timestamp - u2 <= HEARTBEAT, "stale");
      p = uint256(b);
    }
    return p;
  }
}
`;

/** ETH/USD primary, USD/ETH fallback used without inversion. */
export const INVERSION_MISMATCH = `${HEAD}
  function price() public view returns (uint256 p) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    p = uint256(a);
    if (p == 0) {
      (, int256 b, , , ) = usdEthFeed.latestRoundData();
      p = uint256(b);
    }
  }
}
`;

/** The same inverse feed, inverted explicitly. */
export const SAFE_EXPLICIT_INVERSION = `${HEAD}
  function price() public view returns (uint256 p) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    p = uint256(a);
    if (p == 0) {
      (, int256 b, , , ) = usdEthFeed.latestRoundData();
      p = 1e36 / uint256(b);
    }
  }
}
`;

/** ETH/USD primary, ETH/EUR fallback. */
export const QUOTE_ASSET_MISMATCH = `${HEAD}
  function price() public view returns (uint256 p) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    p = uint256(a);
    if (p == 0) {
      (, int256 b, , , ) = ethEurFeed.latestRoundData();
      p = uint256(b);
    }
  }
}
`;

/** Same pair, both paths normalized by the same adapter helper, same freshness. */
export const SAFE_EXPLICIT_ADAPTER = `${HEAD}
  function price() public view returns (uint256 p) {
    try ethUsdFeed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
      require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
      p = _toWad(ethUsdFeed, answer);
    } catch {
      (, int256 a2, , uint256 u2, ) = ethUsdBackupFeed.latestRoundData();
      require(block.timestamp - u2 <= HEARTBEAT, "stale");
      p = _toWad(ethUsdBackupFeed, a2);
    }
  }
}
`;

/** Both paths check freshness but with different thresholds. */
export const STALE_THRESHOLD_DIFFERS = `${HEAD}
  function price() public view returns (uint256 p) {
    try ethUsdFeed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
      require(block.timestamp - updatedAt <= HEARTBEAT, "stale");
      p = _toWad(ethUsdFeed, answer);
    } catch {
      (, int256 a2, , uint256 u2, ) = ethUsdBackupFeed.latestRoundData();
      require(block.timestamp - u2 <= FALLBACK_HEARTBEAT, "stale");
      p = _toWad(ethUsdBackupFeed, a2);
    }
  }
}
`;

/** Two feeds combined unconditionally: not a fallback relationship. */
export const NOT_A_FALLBACK = `${HEAD}
  function combined() public view returns (uint256) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    (, int256 b, , , ) = ethEurFeed.latestRoundData();
    return uint256(a) * uint256(b);
  }
}
`;

export const SINGLE_SOURCE = `${HEAD}
  function price() public view returns (uint256) {
    (, int256 a, , , ) = ethUsdFeed.latestRoundData();
    return uint256(a);
  }
}
`;
