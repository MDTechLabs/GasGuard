# Permit domain separator construction (`GG-SIG-PERMIT-001`)

Detector: `rules/security/signatures/detect-permit-domain-separator.ts` · Tests: `rules/security/signatures/__tests__/detect-permit-domain-separator.spec.ts`

## What it detects

Incorrectly built EIP-712 domain separators in EIP-2612 permit-style contracts. Every `keccak256(abi.encode(DOMAIN_TYPEHASH, ...))` whose type hash resolves to an `EIP712Domain(...)` type is checked (inline string, a `bytes32 constant` in the source, or the standard 4-field hash). Returns the normalized `RuleResult` plus `domains` (each separator with fields and status `ok` / `flagged`). This complements `sig-missing-domain-separation`, which checks whether a signature check uses a domain at all.

| `kind` | Meaning | Severity |
| --- | --- | --- |
| `domain-type-missing-field` | Type string omits `chainId` (cross-chain/fork replay) or `verifyingContract` (cross-contract replay). | high / medium |
| `domain-encoding-mismatch` | Number of encoded values differs from the declared fields, or `verifyingContract` is `msg.sender` / `tx.origin` / `address(0)`. | medium |
| `hardcoded-chain-id` | `chainId` is a numeric literal. | medium |
| `unhashed-dynamic-field` | A `string` / `bytes` field (name, version) is encoded without `keccak256`; wallets compute a different separator. | medium |
| `cached-domain-separator-chainid` | A separator computed once with `block.chainid` is stored and `block.chainid` is never compared in the contract, so it is stale after a fork. | medium |

## Accepted patterns

The Solmate/OpenZeppelin pattern: cache the separator and return a recomputed one when `block.chainid != INITIAL_CHAIN_ID`. Contracts that only inherit OpenZeppelin `EIP712` build no separator and are not reported. Pre-hashed values such as `_hashedName` are accepted for `string` fields.

## Assumptions and limitations

- Solidity 0.6 – 0.8.x, one source string; helper functions that build the encoded arguments are not followed, and type hashes that are not visible in the source are skipped.
- Only the standard 4-field `EIP712Domain` hash is recognized by its hex value; other hex hashes are skipped.
- Malformed, empty, oversized or non-Solidity input returns `analyzed: false` with diagnostics; no project scripts or configuration are executed.
- False positives: a deliberately single-chain token may hardcode its chain id; document that choice and accept the finding.

## Fixtures

Vulnerable: `keccak256(abi.encode(TYPEHASH, name, version, 1, msg.sender))`.
Safe: `keccak256(abi.encode(TYPEHASH, keccak256(bytes("T")), keccak256(bytes("1")), block.chainid, address(this)))`. More cases are in the spec.
