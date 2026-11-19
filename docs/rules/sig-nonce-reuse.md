# Nonce reuse across multiple authorization methods (`sig-nonce-reuse`)

Issue: #1376 · Detector: `rules/security/signatures/detect-nonce-reuse.ts` · Tests: `rules/security/signatures/__tests__/detect-nonce-reuse.spec.ts`

## What it detects

Whether permit, meta-transaction, order and administrative signatures share or accidentally bypass nonce-consumption rules: a nonce that is validated but never consumed, consumed only on some paths or after an external call, a shared nonce store consumed by one method but only checked by another, independent nonce stores signing the same layout, and signed state-changing methods with no replay guard.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Each signature-verifying function gets a read set (nonce stores in `require`/`assert`/`if`) and a write set (`nonces[x]++`, `+= 1`, `= nonce + 1`, `used[x][n] = true`, `_useNonce(...)`, or an in-file helper that writes a store). Stores are identifiers named nonce*, used*, executed*, consumed* that are not locals or parameters. Findings: validated-not-consumed (high); consumed after the first external call (high, reentrant replay); consumed only inside a conditional block (medium); no nonce and no executed/used marker in a state-changing external signed method (medium); two methods with different stores and identical signed field lists and no distinguishing purpose (medium). Separate nonce spaces are accepted when the signed payloads carry different purpose markers (distinct `*TYPEHASH`/`PURPOSE` constants, string labels, `msg.sig`) and when methods share one store that both consume.

## Severity and confidence

High for replay or reentrancy windows on a method that already uses a nonce; medium for missing replay guard, conditional consumption and ambiguous cross-method layouts.

## Assumptions and limitations

- Nonce stores are recognised by name.
- Consumption through helpers is followed only for helpers in this file or named like `_useNonce`.
- Internal verification helpers called from an external function are not merged into the caller.
- Cross-method replay needs matching nonce values in both stores; the rule reports the identical layout as a risk, not a proven exploit.

## False-positive considerations

Nonce spaces that are separated by an argument (a `purpose` parameter or domain value) are not recognised and can be reported as ambiguous; add a distinct typehash to the payload. Methods guarded by a modifier that consumes the nonce are reported as validate-only unless the modifier is a helper defined in the same file and called from the function.

## Fixtures

Vulnerable:

```solidity
contract Exec {
  mapping(address => uint256) public nonces;
  function exec(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to]);
    bytes32 hash = keccak256(abi.encode(to, amount, nonce));
    address signer = ECDSA.recover(hash, sig);
  }
}
```

Safe counterexample:

```solidity
contract Exec {
  mapping(address => uint256) public nonces;
  function exec(address to, uint256 amount, uint256 nonce, bytes memory sig) external {
    require(nonce == nonces[to]++);
    bytes32 hash = keccak256(abi.encode(to, amount, nonce));
    address signer = ECDSA.recover(hash, sig);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "sig-nonce-reuse",
  "message": "exec() checks nonces but never increments or marks it used: the same signature can be replayed.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 3,
    "endLine": 3
  },
  "suggestedFix": {
    "description": "Increment or mark the nonce used (before any external call) in every path.",
    "documentationUrl": "https://docs.gasguard.dev/rules/sig-nonce-reuse"
  },
  "metadata": {
    "title": "Nonce is validated but never consumed",
    "confidence": "high",
    "function": "exec",
    "evidence": [
      "reads: nonces",
      "writes: none"
    ],
    "rationale": "A nonce that is only checked does not stop replay; the signed message stays valid forever.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/signatures/__tests__/detect-nonce-reuse.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
