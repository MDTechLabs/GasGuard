/** Solidity fixtures for GG-XCHAIN-REPLAY-001. */

/** Duplicate delivery: nothing records the message as consumed. */
export const DUPLICATE_DELIVERY = `
pragma solidity ^0.8.20;
contract Bridge {
  mapping(address => uint256) public balances;
  function executeMessage(bytes32 messageId, uint32 srcChain, address sender, bytes calldata payload) external {
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Cross-domain replay: replay key is the nonce only. */
export const CROSS_DOMAIN_REPLAY = `
pragma solidity ^0.8.20;
contract Receiver {
  mapping(uint64 => bool) public processed;
  mapping(address => uint256) public balances;
  function handle(uint32 srcChain, address sender, uint64 nonce, bytes calldata payload) external {
    require(!processed[nonce], "replayed");
    processed[nonce] = true;
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Key includes the source chain but not the remote sender. */
export const MISSING_SENDER_IN_KEY = `
pragma solidity ^0.8.20;
contract Receiver {
  mapping(uint32 => mapping(uint64 => bool)) public processed;
  mapping(address => uint256) public balances;
  function handle(uint32 srcChain, address sender, uint64 nonce, bytes calldata payload) external {
    require(!processed[srcChain][nonce], "replayed");
    processed[srcChain][nonce] = true;
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

export const SAFE_HASHED_KEY = `
pragma solidity ^0.8.20;
contract Receiver {
  mapping(bytes32 => bool) public processed;
  mapping(address => uint256) public balances;
  function handle(uint32 srcChain, address sender, uint64 nonce, bytes calldata payload) external {
    bytes32 key = keccak256(abi.encode(srcChain, sender, nonce));
    require(!processed[key], "replayed");
    processed[key] = true;
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

export const SAFE_NESTED_MAPPING = `
pragma solidity ^0.8.20;
contract Receiver {
  mapping(uint32 => mapping(address => mapping(uint64 => bool))) public processed;
  mapping(address => uint256) public balances;
  function handle(uint32 srcChain, address sender, uint64 nonce, bytes calldata payload) external {
    if (processed[srcChain][sender][nonce]) revert();
    processed[srcChain][sender][nonce] = true;
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Replay-key logic lives in a same-file internal helper. */
export const SAFE_VIA_HELPER = `
pragma solidity ^0.8.20;
contract Receiver {
  mapping(bytes32 => bool) public processed;
  mapping(address => uint256) public balances;
  function _markProcessed(uint32 srcChain, address sender, uint64 nonce) internal {
    bytes32 key = keccak256(abi.encode(srcChain, sender, nonce));
    require(!processed[key], "replayed");
    processed[key] = true;
  }
  function handle(uint32 srcChain, address sender, uint64 nonce, bytes calldata payload) external {
    _markProcessed(srcChain, sender, nonce);
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** LayerZero-style receiver: the authenticated endpoint is the replay guard. */
export const TRANSPORT_GUARANTEED = `
pragma solidity ^0.8.20;
contract OApp {
  address public endpoint;
  mapping(address => uint256) public balances;
  function lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message) external {
    require(msg.sender == endpoint, "only endpoint");
    (address to, uint256 amount) = abi.decode(_message, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** The record is written but never consulted. */
export const WRITE_WITHOUT_CHECK = `
pragma solidity ^0.8.20;
contract Receiver {
  mapping(bytes32 => bool) public processed;
  mapping(address => uint256) public balances;
  function handle(bytes32 id, bytes calldata payload) external {
    processed[id] = true;
    balances[msg.sender] += 1;
  }
}
`;

export const NOT_A_HANDLER = `
pragma solidity ^0.8.20;
contract Admin {
  address public owner;
  function setOwner(address o) external { owner = o; }
}
`;
