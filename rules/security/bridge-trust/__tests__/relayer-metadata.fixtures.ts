/** Solidity fixtures for GG-XCHAIN-METADATA-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Minter {
  address public endpoint;
  bytes32 public root;
  mapping(uint32 => address) public trustedRemotes;
  mapping(uint32 => bytes32) public peers;
  mapping(address => uint256) public balances;
  function _mint(address to, uint256 amount) internal { balances[to] += amount; }
`;

/** Spoofed metadata: chain and sender are plain calldata parameters. */
export const SPOOFABLE_PARAMETERS = `${HEAD}
  function receiveMessage(uint32 srcChain, address sender, address to, uint256 amount) external {
    require(trustedRemotes[srcChain] == sender, "untrusted");
    _mint(to, amount);
  }
}
`;

/** The same receiver, but the caller must be the endpoint. */
export const AUTHENTICATED_ENDPOINT = `${HEAD}
  function receiveMessage(uint32 srcChain, address sender, address to, uint256 amount) external {
    require(msg.sender == endpoint, "only endpoint");
    require(trustedRemotes[srcChain] == sender, "untrusted");
    _mint(to, amount);
  }
}
`;

/** Metadata flows through an alias before the access check. */
export const ALIASED_METADATA = `${HEAD}
  function receiveMessage(uint32 srcChain, address sender, address to, uint256 amount) external {
    uint32 chain = srcChain;
    require(trustedRemotes[chain] == sender, "untrusted");
    _mint(to, amount);
  }
}
`;

/** Metadata decoded from a caller-supplied payload. */
export const DECODED_METADATA = `${HEAD}
  function receivePayload(bytes calldata payload) external {
    (uint32 srcChain, address sender, address to, uint256 amount) = abi.decode(payload, (uint32, address, address, uint256));
    require(trustedRemotes[srcChain] == sender, "untrusted");
    balances[to] += amount;
  }
}
`;

/** LayerZero-v2-style: origin is supplied by the authenticated endpoint. */
export const ENDPOINT_PROVIDED_ORIGIN = `${HEAD}
  function lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message) external {
    require(msg.sender == endpoint, "only endpoint");
    require(peers[_origin.srcEid] != bytes32(0), "peer");
    (address to, uint256 amount) = abi.decode(_message, (address, uint256));
    _mint(to, amount);
  }
}
`;

/** Proof accepted but never verified. */
export const PROOF_IGNORED = `${HEAD}
  function claim(bytes32[] calldata proof, address to, uint256 amount) external {
    balances[to] += amount;
  }
}
`;

export const PROOF_VERIFIED = `${HEAD}
  function claim(bytes32[] calldata proof, address to, uint256 amount) external {
    require(MerkleProof.verify(proof, root, keccak256(abi.encodePacked(to, amount))), "bad proof");
    balances[to] += amount;
  }
}
`;

/** ERC20-style transferFrom takes a `sender`, but is not a cross-chain receiver. */
export const NOT_A_BRIDGE = `${HEAD}
  function transferFrom(address sender, address recipient, uint256 amount) public {
    balances[sender] -= amount;
    balances[recipient] += amount;
  }
}
`;

export const EVENT_ONLY = `${HEAD}
  event Received(uint32 srcChain, address sender);
  function receiveMessage(uint32 srcChain, address sender, bytes calldata payload) external {
    emit Received(srcChain, sender);
  }
}
`;

/** Non-standard parameter names, configured by option. */
export const CUSTOM_PARAMETER_NAMES = `${HEAD}
  function ingest(uint32 hop, address emitter, address to, uint256 amount) external {
    require(trustedRemotes[hop] == emitter, "untrusted");
    _mint(to, amount);
  }
}
`;
