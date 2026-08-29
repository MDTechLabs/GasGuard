# Missing Signature Domain Separation Rule

## Overview

The **Missing Signature Domain Separation** rule detects incomplete or absent EIP-712 domain separation in signature verification code. This is a critical security issue that enables replay attacks.

## Security Risk

Missing domain separation in ECDSA signature verification creates a **critical vulnerability** that allows:

1. **Cross-Chain Replay Attacks**: A signature valid on Ethereum mainnet could be replayed on Polygon or other chains
2. **Contract Context Replay**: A signature for one contract could be used on another instance of the same contract
3. **Type Confusion**: Signatures for different transaction types could be replayed in wrong contexts

## What is EIP-712 Domain Separation?

EIP-712 is the Ethereum standard for typed, structured data signing. It includes a **domain separator** to prevent replay attacks:

```solidity
// Domain separator includes critical context
bytes32 DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

// Computed domain includes chainId and contract address
bytes32 domainSeparator = keccak256(abi.encode(
    DOMAIN_TYPEHASH,
    keccak256(bytes("MyApp")),      // Application name
    keccak256(bytes("1")),           // Version
    block.chainid,                   // CRITICAL: Chain ID
    address(this)                    // CRITICAL: Contract address
));

// Message hash includes domain separator
bytes32 digest = keccak256(abi.encodePacked(
    "\x19\x01",                      // EIP-191 prefix
    domainSeparator,                 // Domain context
    hashStruct(message)              // Message hash
));

// Signature verified against domain-separated digest
address signer = ecrecover(digest, v, r, s);
```

## What This Rule Detects

### ❌ **Critical**: Complete Absence of Domain Separation

```solidity
// VIOLATION: No domain separation
function recoverSigner(bytes32 hash, bytes memory sig) public pure returns (address) {
    (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
    address signer = ecrecover(hash, v, r, s);  // ❌ Direct recovery, no domain!
    return signer;
}
```

**Risk**: Any valid signature can be replayed across chains and contracts.

### ⚠️ **High**: Incomplete Domain Separation

```solidity
// VIOLATION: Has DOMAIN_TYPEHASH but missing computation
bytes32 constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(...)");

function recoverSigner(bytes32 hash, bytes memory sig) public pure returns (address) {
    (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
    return ecrecover(hash, v, r, s);  // ❌ Still no domain separator used!
}
```

**Risk**: Domain typehash defined but never applied.

### ⚠️ **High**: Missing Chain ID

```solidity
// VIOLATION: Domain separator without chainId
function computeDomainSeparator() internal view returns (bytes32) {
    return keccak256(abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes("MyApp")),
        keccak256(bytes("1")),
        // ❌ Missing: block.chainid
        address(this)
    ));
}
```

**Risk**: Signatures valid on one chain can be replayed on another.

## ✅ **Correct** Implementation

```solidity
// 1. Define domain typehash
bytes32 constant DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

// 2. Compute domain separator with all required fields
function computeDomainSeparator() internal view returns (bytes32) {
    return keccak256(abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes("MyApp")),           // ✅ App name
        keccak256(bytes("1")),               // ✅ Version
        block.chainid,                       // ✅ Chain ID
        address(this)                        // ✅ Contract address
    ));
}

// 3. Define message typehash
bytes32 constant MESSAGE_TYPEHASH = keccak256(
    "Message(address to,uint256 amount,uint256 nonce)"
);

// 4. Hash the message
function hashMessage(address to, uint256 amount, uint256 nonce)
    internal pure returns (bytes32)
{
    return keccak256(abi.encode(
        MESSAGE_TYPEHASH,
        to,
        amount,
        nonce
    ));
}

// 5. Create domain-separated digest
function getDigest(address to, uint256 amount, uint256 nonce)
    internal view returns (bytes32)
{
    bytes32 domainSeparator = computeDomainSeparator();
    bytes32 structHash = hashMessage(to, amount, nonce);
    return keccak256(abi.encodePacked(
        "\x19\x01",              // ✅ EIP-191 prefix
        domainSeparator,         // ✅ Domain context
        structHash               // ✅ Message hash
    ));
}

// 6. Recover and verify signature
function verify(
    address to,
    uint256 amount,
    uint256 nonce,
    bytes memory sig
) public view returns (address) {
    bytes32 digest = getDigest(to, amount, nonce);
    (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
    return ecrecover(digest, v, r, s);  // ✅ Verified against domain-separated digest
}
```

## References

- **EIP-712**: https://eips.ethereum.org/EIPS/eip-712
- **OpenZeppelin EIP712**: https://docs.openzeppelin.com/contracts/4.x/api/utils#EIP712
- **OpenZeppelin ECDSA**: https://docs.openzeppelin.com/contracts/4.x/api/utils#ECDSA
- **Replay Attack Prevention**: https://blog.openzeppelin.com/replay-attacks-prevention/

## Recommended Libraries

Use battle-tested implementations instead of rolling your own:

```solidity
// OpenZeppelin EIP712
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MyContract is EIP712 {
    bytes32 constant MESSAGE_TYPEHASH = keccak256(
        "Message(address to,uint256 amount,uint256 nonce)"
    );

    constructor() EIP712("MyApp", "1") {}

    function verify(
        address to,
        uint256 amount,
        uint256 nonce,
        bytes calldata sig
    ) public view returns (address) {
        bytes32 structHash = keccak256(abi.encode(
            MESSAGE_TYPEHASH,
            to,
            amount,
            nonce
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        return ECDSA.recover(digest, sig);
    }
}
```

## Rule Configuration

**Rule Name**: `missing-domain-separation`

**Severity Levels**:

- `Critical`: No domain separation detected in signature verification code
- `High`: Incomplete domain separation (missing DOMAIN_TYPEHASH, domainSeparator, or chain ID verification)

**Affected Code Patterns**:

- `ecrecover()` without domain separation
- `ECDSA.recover()` without domain separation
- Signature verification functions lacking EIP-712 structure

## Testing

The rule includes comprehensive tests covering:

1. Detection of missing domain separation (critical violation)
2. Recognition of complete EIP-712 implementations
3. Detection of incomplete implementations
4. Verification of chain ID inclusion

Run tests with:

```bash
cargo test missing_domain_separation
```

## Integration

To use this rule in your analysis:

```rust
use gasguard_rules::{RuleEngine, MissingDomainSeparationRule};

let engine = RuleEngine::new()
    .add_rule(Box::new(MissingDomainSeparationRule));

let violations = engine.analyze(code)?;
```
