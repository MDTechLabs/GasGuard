# Solidity Signature and Authorization Rules

The Solidity analyzer exposes four source-level rules for EIP-712 and signature authorization:

| Rule | Description | Default severity |
| --- | --- | --- |
| `sol-019` | Cached EIP-712 domain separator without a recognized chain-ID refresh | High |
| `sol-020` | Missing EIP-712 type fields or packed dynamic-field hashing | High |
| `sol-021` | `personal_sign`/raw `ecrecover` used for an authorization without a recognized EIP-712 domain | High |
| `sol-022` | ECDSA-only path when contract-wallet signers are configured as expected | Medium |

Findings use the analyzer's normal `ruleId`, message, severity, source location, and suggested-fix fields. `metadata.confidence` and `metadata.evidence` record the static evidence. ERC-1271 findings also set `metadata.issueType` to `compatibility-gap`; the rule does not claim that ECDSA-only recovery is an authorization bypass.

## Configuration

ERC-1271 support is opt-in because a protocol may intentionally support EOA signers only. The default expected signer set is `["eoa"]`. Configure either project-wide:

```json
{
  "options": {
    "signatureSecurity": {
      "expectedSignerTypes": ["eoa", "contract"]
    }
  }
}
```

or on `sol-022`, which takes precedence:

```json
{
  "rules": {
    "sol-022": {
      "enabled": true,
      "options": {
        "expectedSignerTypes": ["eoa", "contract"]
      }
    }
  }
}
```

Only the values `eoa` and `contract` are accepted; the list must be non-empty.

## Analysis assumptions and limits

- The checks are source-level lexical analysis; no Solidity compiler, AST, bytecode, remappings, imports, inheritance resolution, optimizer, or `viaIR` setting is used. A pragma is optional. When present, supported compiler-language versions are Solidity 0.5.x through 0.8.x.
- Inputs containing NUL bytes, exceeding 1 MiB, containing mismatched delimiters, or declaring an unsupported/unreadable pragma are skipped by these detectors and return a diagnostic in `AnalysisResult.errors`.
- `sol-019` recognizes constructor/initializer-time use of `block.chainid` with a domain-separator-like variable and suppresses a finding when it sees a chain-ID comparison and domain rebuild marker. This does not prove that the branch is correct or that all verification paths use it. Proxy initialization is especially important: domain data should be initialized against proxy storage/address, not only the implementation constructor.
- `sol-020` compares fields spelled in a literal `*TYPEHASH` declaration with fields in `abi.encode`/`abi.encodePacked` expressions that reference that constant. It recognizes simple top-level fields, nested field names, arrays and dynamic `string`/`bytes` field mentions; it does not prove canonical type-string correctness, ordering, nested-struct hashing, array hashing, or inherited type definitions. Review each reported expression against the EIP-712 specification.
- `sol-021` requires an `ecrecover` call and authorization-like evidence in the same function. The check is intentionally conservative about informational signature verification, but it can miss authorization spread across helper functions and can report custom domain schemes it does not recognize.
- `sol-022` reports only when `contract` signers are explicitly expected. It checks the local authorization function for `isValidSignature`/`IERC1271`; validation delegated to an opaque helper may be reported as a compatibility gap.
- These rules do not compile source or determine runtime behavior. Findings are triage signals, not proof of exploitability. Compiler errors, inline assembly, generated Solidity, unconventional naming, and cross-contract call flows may reduce coverage.

## Fixtures and verification

Reproducible vulnerable and safe examples, including normalized expected rule IDs, severity, locations, and confidence, are in [`tests/fixtures/signature-authorization`](../../tests/fixtures/signature-authorization). The focused regression suite is [`signature-security.spec.ts`](../../libs/engine/analyzers/signature-security.spec.ts).

Run the focused checks from the repository root with:

```sh
npx jest libs/engine/analyzers/signature-security.spec.ts --runInBand
npx tsc -p libs/engine/tsconfig.json --noEmit
```

The rules are linear scans over source bounded at 1 MiB; they add no compiler or network dependency. Benchmark impact and independent security review should be recorded with the implementation's pull request before release.
