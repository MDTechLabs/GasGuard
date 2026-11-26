# Unsafe signature recovery and malleable ECDSA handling (`GG-SIG-RECOVERY-001`)

Issue: #1302 · Detector: `rules/security/signatures/detect-ecdsa-malleability.ts`

## What it detects

| Kind | Severity | Meaning |
| --- | --- | --- |
| `missing-s-upper-bound` | medium | raw `ecrecover` with no check that `s` is in the lower half of the curve order (EIP-2) |
| `missing-v-check` | low | `v` is never compared with 27 or 28 |
| `missing-zero-address-check` | medium (low if compared) | the recovered address is not checked against `address(0)` |
| `signature-hash-as-identifier` | high | `keccak256(signature)` used as an id in a function that recovers a signer |

## Supported inputs

- Solidity 0.6 to 0.8.x source text, one file. No project scripts or configuration are read or executed.
- Empty, non-string, oversized or non-Solidity input returns `analyzed: false` with an error diagnostic. Unbalanced delimiters give a warning diagnostic. The detector never throws.

## Determinism

Findings carry a stable `ruleId` and `kind`, a 1-based `line` and `column`, and are sorted by line, column and kind, so the same input always gives the same output.

## Limitations

- Only raw `ecrecover` calls are analyzed. Assembly and `staticcall` to address 1 are not seen.
- Validation in a called helper or inherited modifier is not followed and can be reported as missing.
- `ECDSA.recover` and `SignatureChecker` are assumed safe and are not flagged.

## False positives

If `s` and `v` are validated in a helper, move the checks next to the `ecrecover` call or use the OpenZeppelin library.
