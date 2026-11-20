/** Solidity fixtures for GG-XCHAIN-PAYLOAD-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Handler {
  mapping(address => uint256) public balances;
`;

/** No version field and no length check. */
export const NO_VERSION = `${HEAD}
  function handle(bytes calldata payload) external {
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Version decoded and ignored. */
export const VERSION_UNCHECKED = `${HEAD}
  function handle(bytes calldata payload) external {
    (uint8 version, address to, uint256 amount) = abi.decode(payload, (uint8, address, uint256));
    balances[to] += amount;
  }
}
`;

/** Dispatch on version without a terminal revert (future-version payloads fall through). */
export const FALLTHROUGH = `${HEAD}
  function handle(bytes calldata payload) external {
    (uint8 version, address to, uint256 amount) = abi.decode(payload, (uint8, address, uint256));
    if (version == 1) {
      balances[to] += amount;
    } else if (version == 2) {
      balances[to] += amount * 2;
    }
  }
}
`;

export const SAFE_REQUIRE_VERSION = `${HEAD}
  function handle(bytes calldata payload) external {
    (uint8 version, address to, uint256 amount) = abi.decode(payload, (uint8, address, uint256));
    require(version == 1, "unsupported version");
    balances[to] += amount;
  }
}
`;

/** Explicit backward-compatible handling of v1 and v2 with a terminal revert. */
export const SAFE_BACKWARD_COMPATIBLE = `${HEAD}
  function handle(bytes calldata payload) external {
    (uint8 version, address to, uint256 amount) = abi.decode(payload, (uint8, address, uint256));
    if (version == 1) {
      balances[to] += amount;
    } else if (version == 2) {
      balances[to] += amount * 2;
    } else {
      revert("unsupported version");
    }
  }
}
`;

export const SAFE_EXACT_LENGTH = `${HEAD}
  function handle(bytes calldata payload) external {
    require(payload.length == 64, "bad length");
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Version byte read from the payload prefix, then validated. */
export const SAFE_VERSION_PREFIX = `${HEAD}
  function handle(bytes calldata payload) external {
    uint8 version = uint8(payload[0]);
    require(version == 1, "unsupported version");
    (address to, uint256 amount) = abi.decode(payload[1:], (address, uint256));
    balances[to] += amount;
  }
}
`;

const STRUCT = `
pragma solidity ^0.8.20;
contract Handler {
  struct Msg { uint8 version; address to; uint256 amount; }
  mapping(address => uint256) public balances;
`;

export const STRUCT_VERSION_UNCHECKED = `${STRUCT}
  function handle(bytes calldata payload) external {
    Msg memory m = abi.decode(payload, (Msg));
    balances[m.to] += m.amount;
  }
}
`;

export const STRUCT_VERSION_CHECKED = `${STRUCT}
  function handle(bytes calldata payload) external {
    Msg memory m = abi.decode(payload, (Msg));
    require(m.version == 1, "unsupported version");
    balances[m.to] += m.amount;
  }
}
`;

/** One payload, two shapes, nothing choosing between them. */
export const AMBIGUOUS_FORMAT = `${HEAD}
  function handle(bytes calldata payload) external {
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    (address to2, uint256 amount2, uint256 fee) = abi.decode(payload, (address, uint256, uint256));
    balances[to] += amount;
    balances[to2] += amount2 - fee;
  }
}
`;

/** Decoded data never reaches state. */
export const DECODE_WITHOUT_EFFECT = `
pragma solidity ^0.8.20;
contract Handler {
  event Seen(address to, uint256 amount);
  function handle(bytes calldata payload) external {
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    emit Seen(to, amount);
  }
}
`;

/** A custom discriminator name, configured by option. */
export const CUSTOM_DISCRIMINATOR = `${HEAD}
  function handle(bytes calldata payload) external {
    (uint8 flavor, address to, uint256 amount) = abi.decode(payload, (uint8, address, uint256));
    balances[to] += amount;
  }
}
`;
