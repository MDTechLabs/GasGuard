/** Solidity fixtures for GG-XCHAIN-SENDER-001. */

export const NO_AUTHENTICATION = `
pragma solidity ^0.8.20;
contract Token {
  mapping(address => uint256) public balances;
  function receiveMessage(uint32 srcChain, address sender, bytes calldata payload) external {
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Endpoint is authenticated; the remote application is not. */
export const ENDPOINT_ONLY = `
pragma solidity ^0.8.20;
contract Token {
  address public endpoint;
  mapping(address => uint256) public balances;
  function receiveMessage(uint32 srcChain, address sender, bytes calldata payload) external {
    require(msg.sender == endpoint, "only endpoint");
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Remote sender compared, but the caller is not the endpoint: sender is forgeable. */
export const REMOTE_ONLY = `
pragma solidity ^0.8.20;
contract Token {
  mapping(uint32 => address) public trustedRemotes;
  mapping(address => uint256) public balances;
  function receiveMessage(uint32 srcChain, address sender, bytes calldata payload) external {
    require(trustedRemotes[srcChain] == sender, "untrusted remote");
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

export const SAFE_BOTH_INLINE = `
pragma solidity ^0.8.20;
contract Token {
  address public endpoint;
  mapping(uint32 => address) public trustedRemotes;
  mapping(address => uint256) public balances;
  function receiveMessage(uint32 srcChain, address sender, bytes calldata payload) external {
    require(msg.sender == endpoint, "only endpoint");
    require(trustedRemotes[srcChain] == sender, "untrusted remote");
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** LayerZero-v2-style receiver using an endpoint modifier and a peer check on the origin struct. */
export const SAFE_MODIFIER_AND_ORIGIN = `
pragma solidity ^0.8.20;
contract OApp {
  address public endpoint;
  mapping(uint32 => bytes32) public peers;
  mapping(address => uint256) public balances;
  modifier onlyEndpoint() { require(msg.sender == address(endpoint), "ep"); _; }
  function lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message) external onlyEndpoint {
    require(peers[_origin.srcEid] == _origin.sender, "peer");
    (address to, uint256 amount) = abi.decode(_message, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Optimism-style: messenger caller plus xDomainMessageSender comparison. */
export const SAFE_NATIVE_MESSENGER = `
pragma solidity ^0.8.20;
contract L2Gateway {
  address public messenger;
  address public l1Gateway;
  mapping(address => uint256) public balances;
  function finalizeMessage(address to, uint256 amount, bytes calldata payload) external {
    require(msg.sender == address(messenger) && IMessenger(messenger).xDomainMessageSender() == l1Gateway, "bad sender");
    balances[to] += amount;
  }
}
`;

/** Endpoint stored under a non-standard name. */
export const CUSTOM_ENDPOINT_NAME = `
pragma solidity ^0.8.20;
contract Token {
  address public hub;
  mapping(uint32 => address) public trustedRemotes;
  mapping(address => uint256) public balances;
  function receiveMessage(uint32 srcChain, address sender, bytes calldata payload) external {
    require(msg.sender == hub, "only hub");
    require(trustedRemotes[srcChain] == sender, "untrusted remote");
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Internal hook of a known framework base. */
export const FRAMEWORK_HOOK = `
pragma solidity ^0.8.20;
contract MyApp is OApp {
  mapping(address => uint256) public balances;
  function _lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message, address _executor, bytes calldata _extra) internal override {
    (address to, uint256 amount) = abi.decode(_message, (address, uint256));
    balances[to] += amount;
  }
}
`;

export const NO_EFFECTS = `
pragma solidity ^0.8.20;
contract Decoder {
  function handle(bytes calldata payload) external pure returns (uint256) {
    return abi.decode(payload, (uint256));
  }
}
`;
