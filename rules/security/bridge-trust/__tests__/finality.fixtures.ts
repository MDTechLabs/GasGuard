/** Solidity fixtures for GG-XCHAIN-FINALITY-001. */

const HEAD = `
pragma solidity ^0.8.20;
contract Verifier {
  address public endpoint;
  bytes32 public root;
  mapping(bytes32 => bool) public done;
  mapping(address => uint256) public balances;
`;

/** Application verifies a Merkle proof but never checks confirmations. */
export const APP_MANAGED_NO_FINALITY = `${HEAD}
  function submitProof(uint256 blockNumber, bytes32 txHash, bytes32[] calldata proof, address to, uint256 amount) external {
    require(MerkleProof.verify(proof, root, txHash), "bad proof");
    require(!done[txHash], "done");
    done[txHash] = true;
    balances[to] += amount;
  }
}
`;

/** A claim about a source block, accepted on the caller's word. */
export const UNVERIFIED_CLAIM = `${HEAD}
  function claimEvent(uint256 blockNumber, address to, uint256 amount) external {
    balances[to] += amount;
  }
}
`;

export const SAFE_CONFIRMATIONS = `${HEAD}
  uint256 public requiredConfirmations = 12;
  function setRequiredConfirmations(uint256 n) external onlyOwner {
    require(n >= 6, "too low");
    requiredConfirmations = n;
  }
  function submitProof(uint256 confirmations, bytes32 txHash, bytes32[] calldata proof, address to, uint256 amount) external {
    require(confirmations >= requiredConfirmations, "not final");
    require(MerkleProof.verify(proof, root, txHash), "bad proof");
    balances[to] += amount;
  }
}
`;

/** The setter accepts any value, including zero. */
export const UNBOUNDED_SETTER = `${HEAD}
  uint256 public requiredConfirmations = 12;
  function setRequiredConfirmations(uint256 n) external onlyOwner {
    requiredConfirmations = n;
  }
  function submitProof(uint256 confirmations, bytes32 txHash, bytes32[] calldata proof, address to, uint256 amount) external {
    require(confirmations >= requiredConfirmations, "not final");
    require(MerkleProof.verify(proof, root, txHash), "bad proof");
    balances[to] += amount;
  }
}
`;

/** Finality belongs to the authenticated messaging transport. */
export const TRANSPORT_MANAGED = `${HEAD}
  function lzReceive(Origin calldata _origin, bytes32 _guid, bytes calldata _message) external {
    require(msg.sender == endpoint, "only endpoint");
    (address to, uint256 amount) = abi.decode(_message, (address, uint256));
    balances[to] += amount;
  }
}
`;

/** One scalar depth for events from any source chain. */
export const SINGLE_POLICY_MANY_CHAINS = `${HEAD}
  uint256 public requiredConfirmations = 12;
  function submitProof(uint32 srcChain, uint256 confirmations, bytes32 txHash, bytes32[] calldata proof, address to, uint256 amount) external {
    require(confirmations >= requiredConfirmations, "not final");
    require(MerkleProof.verify(proof, root, txHash), "bad proof");
    balances[to] += amount;
  }
}
`;

export const SAFE_PER_CHAIN = `${HEAD}
  mapping(uint32 => uint256) public confirmationsByChain;
  function submitProof(uint32 srcChain, uint256 confirmations, bytes32 txHash, bytes32[] calldata proof, address to, uint256 amount) external {
    require(confirmations >= confirmationsByChain[srcChain], "not final");
    require(MerkleProof.verify(proof, root, txHash), "bad proof");
    balances[to] += amount;
  }
}
`;

/** Finality enforced by a modifier. */
export const SAFE_MODIFIER = `${HEAD}
  mapping(bytes32 => bool) public finalized;
  modifier onlyFinalized(bytes32 txHash) { require(finalized[txHash], "not final"); _; }
  function submitProof(bytes32 txHash, bytes32[] calldata proof, address to, uint256 amount) external onlyFinalized(txHash) {
    require(MerkleProof.verify(proof, root, txHash), "bad proof");
    balances[to] += amount;
  }
}
`;

export const NOT_A_CONSUMER = `${HEAD}
  function deposit(uint256 amount) external {
    balances[msg.sender] += amount;
  }
}
`;
