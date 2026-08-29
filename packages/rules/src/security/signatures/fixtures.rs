//! Test Fixtures for Missing Domain Separation Rule
//!
//! This module contains test code snippets for the MissingDomainSeparationRule.
//! Use these fixtures to understand what the rule detects and validate implementations.

#[cfg(test)]
pub mod fixtures {
    /// Vulnerable: No domain separation whatsoever
    pub const VULNERABLE_NO_DOMAIN_SEPARATION: &str = r#"
        contract Vulnerable {
            function recoverSigner(bytes32 hash, bytes memory sig) public pure returns (address) {
                (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
                address signer = ecrecover(hash, v, r, s);
                return signer;
            }
        }
    "#;

    /// Vulnerable: Domain separator defined but not used
    pub const VULNERABLE_DOMAIN_DEFINED_NOT_USED: &str = r#"
        contract Vulnerable {
            bytes32 constant DOMAIN_TYPEHASH = keccak256(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            );

            function recoverSigner(bytes32 hash, bytes memory sig) public pure returns (address) {
                (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
                return ecrecover(hash, v, r, s);
            }
        }
    "#;

    /// Vulnerable: Missing chain ID in domain separator
    pub const VULNERABLE_MISSING_CHAIN_ID: &str = r#"
        contract Vulnerable {
            bytes32 constant DOMAIN_TYPEHASH = keccak256(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            );

            function computeDomainSeparator() internal view returns (bytes32) {
                return keccak256(abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes("MyApp")),
                    keccak256(bytes("1")),
                    address(this)
                ));
            }

            function recoverSigner(bytes32 hash, bytes memory sig) public view returns (address) {
                bytes32 domainSeparator = computeDomainSeparator();
                bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, hash));
                (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
                return ecrecover(digest, v, r, s);
            }
        }
    "#;

    /// Vulnerable: Missing domain separator usage in signature recovery
    pub const VULNERABLE_DOMAIN_NOT_USED_IN_RECOVERY: &str = r#"
        contract Vulnerable {
            bytes32 constant DOMAIN_TYPEHASH = keccak256(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            );

            function computeDomainSeparator() internal view returns (bytes32) {
                return keccak256(abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes("MyApp")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                ));
            }

            function recoverSigner(bytes32 hash, bytes memory sig) public view returns (address) {
                (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
                return ecrecover(hash, v, r, s);
            }
        }
    "#;

    /// Correct: Full EIP-712 implementation
    pub const CORRECT_FULL_EIP712: &str = r#"
        contract Secure {
            bytes32 constant DOMAIN_TYPEHASH = keccak256(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            );

            bytes32 constant MESSAGE_TYPEHASH = keccak256(
                "Message(address to,uint256 amount,uint256 nonce)"
            );

            function computeDomainSeparator() internal view returns (bytes32) {
                return keccak256(abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes("MyApp")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                ));
            }

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

            function getDigest(address to, uint256 amount, uint256 nonce)
                internal view returns (bytes32)
            {
                bytes32 domainSeparator = computeDomainSeparator();
                bytes32 structHash = hashMessage(to, amount, nonce);
                return keccak256(abi.encodePacked(
                    "\x19\x01",
                    domainSeparator,
                    structHash
                ));
            }

            function verify(
                address to,
                uint256 amount,
                uint256 nonce,
                bytes memory sig
            ) public view returns (address) {
                bytes32 digest = getDigest(to, amount, nonce);
                (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
                return ecrecover(digest, v, r, s);
            }
        }
    "#;

    /// Correct: Using OpenZeppelin EIP712
    pub const CORRECT_OPENZEPPELIN_EIP712: &str = r#"
        import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
        import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

        contract Secure is EIP712 {
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
    "#;

    /// Reference: ECDSA.recover without domain (similar vulnerability)
    pub const VULNERABLE_ECDSA_RECOVER: &str = r#"
        import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

        contract Vulnerable {
            using ECDSA for bytes32;

            function verify(bytes32 hash, bytes memory sig) public pure returns (address) {
                return hash.recover(sig);
            }
        }
    "#;

    /// Reference: Message without proper EIP-712 structure
    pub const VULNERABLE_NO_MESSAGE_TYPEHASH: &str = r#"
        contract Vulnerable {
            bytes32 constant DOMAIN_TYPEHASH = keccak256(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            );

            function computeDomainSeparator() internal view returns (bytes32) {
                return keccak256(abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes("MyApp")),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                ));
            }

            function verify(
                address to,
                uint256 amount,
                uint256 nonce,
                bytes memory sig
            ) public view returns (address) {
                bytes32 domainSeparator = computeDomainSeparator();
                bytes32 messageHash = keccak256(abi.encodePacked(to, amount, nonce));
                bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, messageHash));
                (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
                return ecrecover(digest, v, r, s);
            }
        }
    "#;
}
