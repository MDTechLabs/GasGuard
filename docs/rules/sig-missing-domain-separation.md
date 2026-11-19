# Signatures that omit contract-specific domain separation (`sig-missing-domain-separation`)

Issue: #1375 · Detector: `rules/security/signatures/detect-missing-domain-separation.ts` · Tests: `rules/security/signatures/__tests__/detect-missing-domain-separation.spec.ts`

## What it detects

Custom signature verification whose signed payload is not bound to the intended contract, chain or protocol domain: cross-contract replay (no contract address) and cross-chain replay (no chain id). Also reports an `EIP712Domain(...)` type string that omits `chainId` or `verifyingContract`.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Every `ecrecover`, `ECDSA.recover/tryRecover`, `SignatureChecker.isValidSignatureNow` and `isValidSignature` call is located and its digest resolved: local assignments are followed and in-file hashing helpers are inlined (up to three levels). EIP-712 is recognised through `_hashTypedDataV4`, `toTypedDataHash`, a `DOMAIN_SEPARATOR`/`domainSeparator` value or the `\x19\x01` prefix. Equivalent custom binding needs both `address(this)` (or `verifyingContract`) and `block.chainid` (or a chainId value) in the payload. Only one of them is a partial binding (medium); neither is replayable across contracts and chains (high). The fields hashed into the digest are listed as evidence.

Nonce replay protection is a different property and is reported by `sig-nonce-reuse`; this rule reports each signature check once and only for domain binding.

## Severity and confidence

High when neither contract nor chain is bound; medium for partial binding or an incomplete EIP712Domain type.

## Assumptions and limitations

- Hashing helpers are resolved only inside this file.
- A value merely mentioned in the payload text counts as bound.
- Domain separators held in variables with other names are not recognised.
- Single-chain contracts that intentionally omit the chain id are still reported as partial binding.

## False-positive considerations

Contracts that inherit the digest construction from a library the detector cannot see are reported as unbound unless they call a recognised EIP-712 helper. Rename or route the digest through `_hashTypedDataV4` to document the binding.

## Fixtures

Vulnerable:

```solidity
contract Claims {
  function claim(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    bytes32 digest = keccak256(abi.encodePacked(to, amount, nonce));
    address signer = ECDSA.recover(digest, sig);
  }
}
```

Safe counterexample:

```solidity
contract Claims {
  function claim(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    bytes32 digest = keccak256(abi.encode(block.chainid, address(this), to, amount, nonce));
    address signer = ECDSA.recover(digest, sig);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "sig-missing-domain-separation",
  "message": "The signature checked in claim() covers a payload without the contract address and the chain id, so the same signature can be replayed across contracts and across chains.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 4,
    "endLine": 4
  },
  "suggestedFix": {
    "description": "Hash through _hashTypedDataV4 (EIP-712), or include block.chainid and address(this) in the signed data.",
    "documentationUrl": "https://docs.gasguard.dev/rules/sig-missing-domain-separation"
  },
  "metadata": {
    "title": "Signed payload is not bound to a contract or chain domain",
    "confidence": "medium",
    "function": "claim",
    "evidence": [
      "address signer = ECDSA.recover(digest, sig)",
      "signed fields: to, amount, nonce",
      "missing binding: the contract address and the chain id",
      "no EIP-712 domain separator or equivalent was found in the signed payload"
    ],
    "rationale": "Nothing ties the signature to this contract or chain; severity high.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/signatures/__tests__/detect-missing-domain-separation.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
