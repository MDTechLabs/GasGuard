/** Solidity fixtures for GG-SIG-PACKED-001. */

/** Two dynamic strings hashed as a signature digest: collision-prone. */
export const VULNERABLE_SIGNATURE_DIGEST = `
pragma solidity ^0.8.20;
contract Claim {
  function digestFor(string memory name, string memory role) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(name, role));
  }
  function verify(string memory name, string memory role, bytes32 r, bytes32 s, uint8 v) external pure returns (address) {
    bytes32 digest = keccak256(abi.encodePacked(name, role));
    return ecrecover(digest, v, r, s);
  }
}
`;

/** Dynamic array + bytes as a mapping key. */
export const VULNERABLE_MAPPING_KEY = `
pragma solidity ^0.8.20;
contract Registry {
  mapping(bytes32 => address) public stored;
  function lookup(uint256[] memory ids, bytes memory data) external view returns (address) {
    return stored[keccak256(abi.encodePacked(ids, data))];
  }
}
`;

export const VULNERABLE_COMMITMENT = `
pragma solidity ^0.8.20;
contract Vote {
  mapping(address => bytes32) public commitments;
  function commit(string memory secret, string memory salt) external {
    commitments[msg.sender] = keccak256(abi.encodePacked(secret, salt));
  }
}
`;

export const SAFE_FIXED_WIDTH = `
pragma solidity ^0.8.20;
contract Pay {
  function hash(address to, uint256 amount, uint256 nonce) external pure returns (bytes32) {
    return keccak256(abi.encodePacked(to, amount, nonce, uint8(1), block.chainid));
  }
}
`;

export const SAFE_SINGLE_DYNAMIC = `
pragma solidity ^0.8.20;
contract Meta {
  function hash(address owner, string memory uri) external pure returns (bytes32) {
    return keccak256(abi.encodePacked(owner, uri));
  }
}
`;

export const SAFE_DELIMITED = `
pragma solidity ^0.8.20;
contract Names {
  function hash(string memory a, string memory b) external pure returns (bytes32) {
    return keccak256(abi.encodePacked(a, "|", b));
  }
}
`;

export const SAFE_ABI_ENCODE = `
pragma solidity ^0.8.20;
contract Names {
  function hash(string memory a, string memory b) external pure returns (bytes32) {
    return keccak256(abi.encode(a, b));
  }
}
`;

/** One dynamic operand next to an operand whose type cannot be resolved. */
export const UNRESOLVED_OPERAND = `
pragma solidity ^0.8.20;
contract Mixed {
  struct Item { bytes payload; }
  function hash(string memory label, Item memory item) external pure returns (bytes32) {
    return keccak256(abi.encodePacked(label, item.payload));
  }
}
`;

export const COMMENTED_OUT = `
pragma solidity ^0.8.20;
contract Names {
  // keccak256(abi.encodePacked(a, b))
  function hash(string memory a) external pure returns (bytes32) {
    return keccak256(abi.encode(a));
  }
}
`;

export const UNBALANCED = `
contract A {
  function f(string memory a, string memory b) external pure returns (bytes32) {
    return keccak256(abi.encodePacked(a, b));
`;

/** Demonstrates the collision on raw bytes: same preimage, different fields. */
export function demonstrateCollision(): { first: string; second: string; equal: boolean } {
  const pack = (...parts: string[]) => Buffer.concat(parts.map((p) => Buffer.from(p, 'utf8'))).toString('hex');
  const first = pack('ab', 'c');
  const second = pack('a', 'bc');
  return { first, second, equal: first === second };
}
