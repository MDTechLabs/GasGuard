import { KBRule } from './types';

export const RULES: KBRule[] = [
  {
    id: 'stellar-network-validation',
    name: 'Stellar Network Validation',
    description: 'Detects Soroban contracts lacking network/environment validation.',
    explanation: 'Soroban contracts may behave differently or incorrectly across different Stellar networks (mainnet, testnet, futurenet) if they do not validate the network environment. Common issues include network-specific addresses, differing ledger properties/fees, and potential security vulnerabilities in sensitive operations.',
    severity: 'high',
    category: 'Security',
    remediation: 'let network = env.ledger().network_passphrase();\nassert!(network.to_bytes() == expected_network_bytes, "Wrong network!");',
    documentationUrl: 'docs/STELLAR_NETWORK_VALIDATION_RULE.md',
    tags: ['stellar', 'network', 'validation', 'passphrase', 'security', 'env']
  },
  {
    id: 'serialization-upgrade-compatibility',
    name: 'Serialization Upgrade Compatibility',
    description: 'Detects incompatible serialization changes during Soroban contract upgrades.',
    explanation: 'When upgrading Soroban contracts, modifying structural definitions (especially those annotated with #[contracttype]) can cause deserialization failures or state corruption. Examples include removing fields, changing field types, or adding required fields without default attributes.',
    severity: 'critical',
    category: 'Upgradeability',
    remediation: 'Use `#[serde(default)]` for new fields, avoid removing fields, or implement custom migration/deserialization logic.',
    documentationUrl: 'docs/SERIALIZATION_UPGRADE_DETECTION.md',
    tags: ['serialization', 'upgrade', 'compatibility', 'contracttype', 'struct', 'serde']
  },
  {
    id: 'unsafe-serialization-pattern',
    name: 'Unsafe Serialization Pattern',
    description: 'Detects unsafe patterns in serialized data or derive macros.',
    explanation: 'Removing Serde derives or modifying serialization behavior without proper state migration can lock user funds or corrupt contract state upon upgrade.',
    severity: 'high',
    category: 'Security',
    remediation: 'Provide custom migration functions or retain required #[derive(serde::Serialize, serde::Deserialize)] attributes.',
    documentationUrl: 'docs/SERIALIZATION_UPGRADE_DETECTION.md',
    tags: ['serialization', 'serde', 'derive', 'migration', 'security']
  },
  {
    id: 'soroban-storage-read',
    name: 'Soroban Storage Read Optimization',
    description: 'Identifies inefficient storage read patterns that can be optimized.',
    explanation: 'Performing multiple read operations on the same storage key within a short scope or function increases CPU and gas costs. Caching the value in a local variable is recommended.',
    severity: 'medium',
    category: 'Optimization',
    remediation: 'let value = env.storage().instance().get(&key).unwrap_or(default_value);\n// Use the local `value` variable instead of calling `.get()` repeatedly.',
    documentationUrl: 'docs/rules/general.md',
    tags: ['storage', 'read', 'optimization', 'gas', 'cache']
  },
  {
    id: 'soroban-map-iteration',
    name: 'Soroban Map Iteration',
    description: 'Detects heavy iteration over Soroban Map collections.',
    explanation: 'Iterating over large Soroban Map collections in a single call consumes considerable CPU and gas budgets. For large datasets, use pagination or chunked iteration instead of iterating through the entire collection.',
    severity: 'high',
    category: 'Optimization',
    remediation: 'Implement chunked iteration or pagination limits when accessing map entries.',
    documentationUrl: 'docs/rules/general.md',
    tags: ['map', 'iteration', 'loop', 'optimization', 'gas', 'pagination']
  },
  {
    id: 'soroban-event-emission',
    name: 'Soroban Event Emission',
    description: 'Checks for efficient event emission patterns in Soroban contracts.',
    explanation: 'Emitting events without topics reduces filtering capabilities for off-chain indexers, and state-changing functions like transfers/mints should emit events to ensure transparency.',
    severity: 'info',
    category: 'Quality',
    remediation: 'env.events().publish((symbol_short!("topic"),), data);',
    documentationUrl: 'docs/rules/general.md',
    tags: ['event', 'publish', 'topics', 'quality', 'transparency']
  },
  {
    id: 'soroban-contract-macro',
    name: 'Soroban Contract Macro Usage',
    description: 'Ensures proper use of #[contract], #[contractimpl], and #[contracttype] macros.',
    explanation: 'Soroban contracts must import soroban_sdk and use standard macro annotations correctly. Missing contracttype macros for impl definitions or duplicating attributes triggers compile-time and runtime failures.',
    severity: 'high',
    category: 'Quality',
    remediation: 'Use `#[contract]` for the main struct, `#[contractimpl]` for implementation blocks, and `#[contracttype]` for custom structs/enums.',
    documentationUrl: 'docs/rules/general.md',
    tags: ['macro', 'contract', 'contractimpl', 'contracttype', 'quality']
  },
  {
    id: 'soroban-env-parameter',
    name: 'Soroban Env Parameter Usage',
    description: 'Ensures Env parameter is properly used in contract functions.',
    explanation: 'Functions performing storage operations (set, put, etc.) must accept the Env parameter in order to access the ledger context.',
    severity: 'medium',
    category: 'Quality',
    remediation: 'pub fn my_function(env: Env, ...) {\n    // storage operations\n}',
    documentationUrl: 'docs/rules/general.md',
    tags: ['env', 'parameter', 'argument', 'storage', 'quality']
  },
  {
    id: 'soroban-storage-pattern',
    name: 'Soroban Storage Pattern',
    description: 'Checks for proper storage access patterns in Soroban contracts.',
    explanation: 'Contracts should use StorageKey for type-safe key management in Persistent storage, and initialize Instance storage correctly to prevent access of uninitialized fields.',
    severity: 'medium',
    category: 'Quality',
    remediation: 'Use an enum annotated with #[contracttype] for storage keys, and initialize values with Instance::new.',
    documentationUrl: 'docs/rules/general.md',
    tags: ['storage', 'pattern', 'persistent', 'instance', 'quality', 'key']
  },
  {
    id: 'stellar-sdk-usage',
    name: 'Stellar SDK Usage',
    description: 'Ensures proper usage of Stellar SDK components and types.',
    explanation: 'Using the Address type without proper authorization validation (e.g., require_auth or require_auth_for_args) exposes sensitive operations to unauthorized calls. BytesN and Map should also specify explicit lengths and types.',
    severity: 'medium',
    category: 'Security',
    remediation: 'address.require_auth();',
    documentationUrl: 'docs/rules/general.md',
    tags: ['sdk', 'address', 'auth', 'bytesn', 'security']
  },
  {
    id: 'stellar-address-validation',
    name: 'Stellar Address Validation',
    description: 'Ensures proper validation of Stellar addresses in contract functions.',
    explanation: 'Every public contract function accepting Address parameters should authorize the caller using require_auth or require_auth_for_args to ensure the identity and permission of the sender.',
    severity: 'high',
    category: 'Security',
    remediation: 'pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {\n    from.require_auth();\n    // ...\n}',
    documentationUrl: 'docs/rules/general.md',
    tags: ['address', 'validation', 'authorization', 'auth', 'security']
  }
];
