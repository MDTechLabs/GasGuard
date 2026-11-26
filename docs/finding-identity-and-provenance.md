# Finding identity and provenance

Two pieces of metadata can be added to analyzer findings. Both are off by default.

## Enabling

Set the analyzer option; nothing else changes and existing result shapes stay the same:

```json
{
  "options": {
    "findingMetadata": true,
    "includePathInFingerprint": false,
    "sourceMaps": {
      "build/flat.sol": [
        { "generatedLine": 812, "sourceFile": "contracts/Vault.sol", "sourceLine": 40 }
      ]
    }
  }
}
```

Each finding then gets `metadata.fingerprint` and `metadata.provenance`.

## Fingerprints (`core/finding-fingerprint.ts`)

`fingerprint.value` is 32 hex characters from SHA-256 over:

- the rule id,
- the enclosing contract, library or interface name and function name,
- the flagged source span, with comments and whitespace normalized away.

Stays the same when: lines are added or removed above the finding; comments or whitespace in
the flagged code change; the message text changes; the file is moved (unless
`includePathInFingerprint` is `true`).

Changes when: the rule id changes; the flagged code changes; the enclosing function or
contract is renamed.

Limitation: a `//` inside a string literal is treated as a comment in the fingerprint input.

## Provenance (`core/finding-provenance.ts`)

`provenance` records where a reported line really comes from. Evidence is used in this order:

1. **`source-map`**: an entry in `sourceMaps` for this file with exactly the reported line.
2. **`flatten-marker`**: the last `// File: path` header before the line (as written by
   Hardhat and Truffle flatteners). The original line is counted from that header.
3. **`none`**: no evidence. The reported location is kept.

`origin` is `generated` for a source-map or flatten match, and for files under build-output
paths such as `artifacts/`, `typechain/`, `build/` or `*.generated.sol`. Otherwise it is
`original`.

Nothing is guessed. A source-map entry for a nearby line is not used.

## Limitations

- Solidity source maps are not parsed from compiler output. The caller supplies the entries.
- A flatten header is only trusted when it appears before the finding.
- Renaming a function or contract changes the fingerprint on purpose.
- Fingerprints are not stable across rule renames; the rule id is part of the identity.
