//! Test Fixtures for Missing Calldata Usage Rule
//!
//! This module contains test code snippets for the MissingCalldataUsageRule.
//! Use these fixtures to understand what the rule detects and validate implementations.

#[cfg(test)]
pub mod fixtures {
    /// Vulnerable: External function with memory array
    pub const VULNERABLE_MEMORY_ARRAY: &str = r#"
        contract Vulnerable {
            function transfer(address[] memory recipients, uint256[] memory amounts) external {
                for (uint i = 0; i < recipients.length; i++) {
                    payable(recipients[i]).transfer(amounts[i]);
                }
            }
        }
    "#;

    /// Vulnerable: External function with memory string
    pub const VULNERABLE_MEMORY_STRING: &str = r#"
        contract Vulnerable {
            function hashData(string memory data) external returns (bytes32) {
                return keccak256(abi.encodePacked(data));
            }
        }
    "#;

    /// Vulnerable: External function with memory bytes
    pub const VULNERABLE_MEMORY_BYTES: &str = r#"
        contract Vulnerable {
            function validate(bytes memory signature) external view returns (bool) {
                return signature.length > 0;
            }
        }
    "#;

    /// Vulnerable: Multiple memory parameters
    pub const VULNERABLE_MULTIPLE_MEMORY: &str = r#"
        contract Vulnerable {
            function batchProcess(
                address[] memory addresses,
                string memory metadata,
                bytes memory data
            ) external {
                for (uint i = 0; i < addresses.length; i++) {
                    processAddress(addresses[i]);
                }
            }
        }
    "#;

    /// Vulnerable: External struct parameter with memory
    pub const VULNERABLE_MEMORY_STRUCT: &str = r#"
        contract Vulnerable {
            struct Transaction {
                address to;
                uint256 amount;
            }

            function executeTxs(Transaction[] memory txs) external {
                for (uint i = 0; i < txs.length; i++) {
                    execute(txs[i]);
                }
            }
        }
    "#;

    /// Correct: External function using calldata arrays
    pub const CORRECT_CALLDATA_ARRAY: &str = r#"
        contract Secure {
            function transfer(address[] calldata recipients, uint256[] calldata amounts) external {
                for (uint i = 0; i < recipients.length; i++) {
                    payable(recipients[i]).transfer(amounts[i]);
                }
            }
        }
    "#;

    /// Correct: External function using calldata string
    pub const CORRECT_CALLDATA_STRING: &str = r#"
        contract Secure {
            function hashData(string calldata data) external returns (bytes32) {
                return keccak256(abi.encodePacked(data));
            }
        }
    "#;

    /// Correct: External function using calldata bytes
    pub const CORRECT_CALLDATA_BYTES: &str = r#"
        contract Secure {
            function validate(bytes calldata signature) external view returns (bool) {
                return signature.length > 0;
            }
        }
    "#;

    /// Correct: Internal function using memory (expected)
    pub const CORRECT_INTERNAL_MEMORY: &str = r#"
        contract Secure {
            function _processData(string memory data) internal returns (bytes32) {
                return keccak256(abi.encodePacked(data));
            }
        }
    "#;

    /// Correct: Mixed - external calldata, internal memory
    pub const CORRECT_MIXED_SCOPES: &str = r#"
        contract Secure {
            function processExternal(address[] calldata addresses) external {
                for (uint i = 0; i < addresses.length; i++) {
                    _processInternal(addresses[i]);
                }
            }

            function _processInternal(address addr) internal {
                string memory data = buildString(addr);
                process(data);
            }

            function buildString(address addr) internal pure returns (string memory) {
                return "processing";
            }
        }
    "#;

    /// Edge Case: External public (treated as external)
    pub const EDGE_CASE_PUBLIC_EXTERNAL: &str = r#"
        contract EdgeCase {
            function process(string calldata data) public {
                bytes32 hash = keccak256(abi.encodePacked(data));
            }
        }
    "#;

    /// Edge Case: Uint8 array (fixed size, should still use calldata)
    pub const EDGE_CASE_UINT_ARRAY: &str = r#"
        contract EdgeCase {
            function sum(uint256[] memory numbers) external returns (uint256) {
                uint256 total = 0;
                for (uint i = 0; i < numbers.length; i++) {
                    total += numbers[i];
                }
                return total;
            }
        }
    "#;

    /// Reference: Using OpenZeppelin patterns
    pub const REFERENCE_OPENZEPPELIN_PATTERN: &str = r#"
        import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

        contract Secure {
            function verifySignature(
                bytes32 hash,
                bytes calldata signature
            ) external pure returns (address) {
                return ECDSA.recover(hash, signature);
            }
        }
    "#;

    /// Reference: Nested arrays (still should use calldata)
    pub const REFERENCE_NESTED_ARRAYS: &str = r#"
        contract Reference {
            function processMatrix(uint256[][] memory matrix) external {
                for (uint i = 0; i < matrix.length; i++) {
                    for (uint j = 0; j < matrix[i].length; j++) {
                        process(matrix[i][j]);
                    }
                }
            }
        }
    "#;
}
