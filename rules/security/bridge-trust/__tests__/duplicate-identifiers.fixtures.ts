/** Solidity fixtures for GG-XCHAIN-DUPID-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Receiver {
  address public endpoint;
  mapping(bytes32 => bool) public executed;
  mapping(address => uint256) public balances;
  mapping(string => string) public names;
`;

/** Replay key is a caller-chosen id. */
export const CALLER_SUPPLIED_ID = `${HEAD}
  function executeMessage(bytes32 messageId, address to, uint256 amount) external {
    require(!executed[messageId], "replayed");
    executed[messageId] = true;
    balances[to] += amount;
  }
}
`;

/** Replay key hashes the raw payload; execution uses decoded fields (padded / alternate encodings). */
export const RAW_PAYLOAD_IDENTITY = `${HEAD}
  function handle(bytes calldata payload) external {
    bytes32 id = keccak256(payload);
    require(!executed[id], "replayed");
    executed[id] = true;
    (address to, uint256 amount) = abi.decode(payload, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** Identity is the nonce only; the executed recipient and amount are not covered. */
export const ID_OMITS_EXECUTED_FIELDS = `${HEAD}
  function handle(uint64 nonce, address to, uint256 amount) external {
    bytes32 id = keccak256(abi.encode(nonce));
    require(!executed[id], "replayed");
    executed[id] = true;
    balances[to] += amount;
  }
}
`;

/** A caller-chosen salt is part of the identity but ignored by execution. */
export const ID_INCLUDES_SALT = `${HEAD}
  function handle(uint32 srcChain, uint64 nonce, address to, uint256 amount, bytes32 salt) external {
    bytes32 id = keccak256(abi.encode(srcChain, nonce, to, amount, salt));
    require(!executed[id], "replayed");
    executed[id] = true;
    balances[to] += amount;
  }
}
`;

/** Identity packs two dynamic strings. */
export const PACKED_DYNAMIC_ID = `${HEAD}
  function handle(string memory name, string memory memo) external {
    bytes32 id = keccak256(abi.encodePacked(name, memo));
    require(!executed[id], "replayed");
    executed[id] = true;
    names[name] = memo;
  }
}
`;

/** Domain-bound, canonical, covers every executed field. */
export const SAFE_CANONICAL_ID = `${HEAD}
  function handle(uint32 srcChain, address sender, uint64 nonce, address to, uint256 amount) external {
    bytes32 id = keccak256(abi.encode(srcChain, sender, nonce, to, amount));
    require(!executed[id], "replayed");
    executed[id] = true;
    balances[to] += amount;
  }
}
`;

/** Same fields as the safe case, in a different order. */
export const SAFE_REORDERED_FIELDS = `${HEAD}
  function handle(uint32 srcChain, address sender, uint64 nonce, address to, uint256 amount) external {
    bytes32 id = keccak256(abi.encode(amount, to, nonce, sender, srcChain));
    require(!executed[id], "replayed");
    executed[id] = true;
    balances[to] += amount;
  }
}
`;

/** The id is supplied by the authenticated endpoint. */
export const TRANSPORT_SUPPLIED_ID = `${HEAD}
  function lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message) external {
    require(msg.sender == endpoint, "only endpoint");
    require(!executed[_guid], "replayed");
    executed[_guid] = true;
    (address to, uint256 amount) = abi.decode(_message, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** The supplied id is verified against a recomputed hash. */
export const SUPPLIED_ID_RECOMPUTED = `${HEAD}
  function executeMessage(bytes32 messageId, address to, uint256 amount) external {
    require(messageId == keccak256(abi.encode(block.chainid, to, amount)), "bad id");
    require(!executed[messageId], "replayed");
    executed[messageId] = true;
    balances[to] += amount;
  }
}
`;
