# Signature and cross-domain message security rules

Four lexical Solidity detectors, all built on the shared toolkit in
[`rules/security/lib/solidity-lite.ts`](../../rules/security/lib/solidity-lite.ts)
and all returning the same normalized result:

```ts
interface RuleResult { ruleId; analyzed: boolean; findings: SecurityFinding[]; diagnostics: Diagnostic[] }
interface SecurityFinding {
  ruleId; kind; severity; confidence; line; column; contract?; function?;
  message; severityRationale; confidenceEvidence: string[]; remediation; details?
}
```

| Rule id | Entry point | Source |
| --- | --- | --- |
| `GG-SIG-PACKED-001` | `detectUnsafePackedHashing` | `rules/security/signatures/detect-unsafe-packed-hashing.ts` |
| `GG-XCHAIN-REPLAY-001` | `detectMissingReplayProtection` | `rules/security/cross-domain/detect-missing-replay-protection.ts` |
| `GG-XCHAIN-SENDER-001` | `detectMissingRemoteSenderAuth` | `rules/security/cross-domain/detect-remote-sender-authentication.ts` |
| `GG-XCHAIN-PAYLOAD-001` | `detectUnvalidatedPayloadDecoding` | `rules/security/cross-domain/detect-unvalidated-payload-decoding.ts` |

## Supported input and general limitations

- Solidity source text, compiler versions 0.6 – 0.8.x (named mapping parameters from 0.8.18 are tolerated).
  Compiler settings (optimizer, via-IR, EVM version) are never consulted.
- One source string at a time. Inherited bases, other files, libraries and external contracts are **not**
  resolved; anything that happens there is invisible to the rules.
- The analysis is lexical and intra-function (plus one level of same-file internal helper calls for the
  replay rule). It reasons from names and shapes, not from a type checker or data-flow engine.
- No repository script is executed and no project configuration is trusted. Options are plain arguments.
- Malformed or unsupported input never throws: non-strings, empty input, oversized input (> 1,000,000
  characters) and text with no `contract` / `library` / `interface` return `analyzed: false` with an
  `error` diagnostic. Unbalanced braces or parentheses produce an `unbalanced-delimiters` warning and the
  rule still analyses what it can.
- Static analysis cannot show that a design is safe. Every rule can be wrong in both directions; see the
  per-rule false-positive notes.

## GG-SIG-PACKED-001 — unsafe `abi.encodePacked` hashing

`abi.encodePacked` has no length prefix or padding for `string`, `bytes` and `T[]`, so
`encodePacked("ab", "c") == encodePacked("a", "bc")`. The rule resolves each operand of an
`abi.encodePacked` call that is hashed (`keccak256` / `sha256` / `ripemd160`, directly or through a
`bytes` local) to one of *fixed*, *dynamic*, *literal* or *unresolved*, using the enclosing function's
parameters and locals plus contract state variables.

- **Reported** (`ambiguous-packed-preimage`): two or more dynamic operands that are not separated by a
  literal delimiter (high confidence), or one dynamic operand next to an unresolved operand (low).
- **Accepted and listed in `safeEncodings`**: all fixed-width operands; exactly one dynamic operand;
  dynamic operands separated by a string/hex literal (`explicit delimiter`).
- **Priority / severity**: signature digest or authorization use → high; commitment, mapping key or
  identifier use → medium; no resolved use → low. Low-confidence findings are capped at medium.
- **Assumptions**: a string-literal separator is accepted as a delimiter even though attacker-controlled
  data can contain the same bytes; prefer `abi.encode`.
- **False positives**: hashes that are never compared against attacker-chosen inputs; operands whose
  content is validated elsewhere to exclude the delimiter.
- **False negatives**: preimages assembled across functions; operand types resolved through struct members,
  call results or inherited state (reported only as low confidence); `abi.encodePacked` used outside a hash.
- **Collision fixture**: `demonstrateCollision()` in
  `rules/security/signatures/__tests__/packed-hashing.fixtures.ts` shows the byte-level collision.

Expected output for `VULNERABLE_SIGNATURE_DIGEST` (hand-derived, abridged): two findings,
`kind: "ambiguous-packed-preimage"`, `severity: "high"`, `confidence: "high"`, functions `digestFor` and
`verify`, `details.operands = [{ expression: "name", type: "string", class: "dynamic" }, { expression: "role", ... }]`.

## GG-XCHAIN-REPLAY-001 — replay protection in cross-domain handlers

Handlers are recognized by well-known receiver names (`lzReceive`, `ccipReceive`, `handle`,
`executeMessage`, ... plus `receiverNames`) or by shape (public/external, `bytes` payload parameter,
handler-like name) and must have value or state effects.

- `missing-replay-protection`: no consumed-message mapping is written.
- `consumed-state-not-checked`: a mapping is written but never consulted.
- `replay-scope-incomplete`: the consumed-message key lacks the source domain and/or the remote sender
  although the handler receives them. Keys are read from nested mapping indices and from a hashed key
  variable (`keccak256(abi.encode(...))`).
- `replay-scope-unverifiable` (low): the key lacks the fields but the handler has no such parameters
  (may be a single-remote design).
- `relies-on-transport-replay-protection` (low): a known framework receiver (`lzReceive`, `ccipReceive`,
  `receiveWormholeMessages`, plus `transportReplayFrameworks`) authenticates the endpoint and keeps no
  application state. This is **an assumption about the transport**, not an application guarantee.
- **False positives**: replay state kept in a base contract, library or another contract; keys using
  names that do not match the domain/sender patterns.
- **False negatives**: replay state that looks present but is keyed by values the attacker controls;
  checks done only via helper calls more than one level deep.

## GG-XCHAIN-SENDER-001 — remote sender authentication

A receiver needs both (1) the caller to be the messaging endpoint and (2) the remote sender to be the
trusted remote for the source chain.

- `unauthenticated-receiver` (critical when value moves): neither identity is checked.
- `remote-sender-unchecked` (high): endpoint checked, remote sender not — any application on the remote side
  can message the contract.
- `endpoint-unauthenticated` (critical when value moves): a remote-sender comparison exists but the caller
  is not authenticated, so the compared value is forgeable.
- `framework-authentication-assumed` (low): an internal `_lzReceive`-style hook of a known base contract
  (`OApp`, `OFT`, `CCIPReceiver`, `AxelarExecutable`, ... plus `frameworkBases`). Pass
  `assumeFrameworkBases: false` to analyze the hook directly instead.
- Endpoint identifiers are matched by name (`endpoint`, `router`, `bridge`, `mailbox`, `gateway`,
  `messenger`, ...) or via the `endpointNames` option; trusted remotes by names such as `trusted`, `peer`,
  `remote`, `gateway` or `remoteNames`. **A name match never makes an address trustworthy**: it only shows
  the caller or sender is compared with a stored value. Where that value is set and who can change it is
  out of scope (see the oracle/adapter replacement rule for setters).
- The finding's `details.untrustedPath` and `details.affectedOperations` name the caller path and the
  state or value operations it reaches.
- **False positives**: checks implemented in a base class or modifier from another file; custom
  endpoint names not passed via options.

## GG-XCHAIN-PAYLOAD-001 — payload decoding without version/schema validation

`abi.decode` ignores trailing bytes and knows nothing about message types. For each receiver, decoded
fields are traced into state-changing statements; findings are only emitted when decoded data reaches an
effect.

- `no-version-field`: no version/type discriminator among the decoded fields and no exact
  `payload.length ==` check.
- `unvalidated-version`: a discriminator (including struct members such as `m.version` and locals such as
  `uint8 version = uint8(payload[0])`) is never compared.
- `unsupported-version-fallthrough`: an `if (version == ...)` chain without a terminal `else revert`.
- `ambiguous-payload-format`: the same payload is decoded with different shapes and nothing selects
  between them (no discriminator, no length check).
- **Accepted**: `require(version == X)`, `if (version != X) revert`, version chains ending in `else revert`,
  checked struct members, exact length checks — i.e. explicit backward-compatible schema handling.
- **Malformed / truncated / future-version fixtures**: see `payload-decoding.fixtures.ts`. In Solidity ≥ 0.8
  a payload shorter than the tuple reverts inside `abi.decode`; the dangerous cases are *longer* payloads
  (future versions appending fields) and payloads whose first field means something else.
- **Limitations**: decoders in other functions or contracts are not followed; discriminator names are
  matched by pattern (extend with `discriminatorNames`).

## Verification evidence

The spec files next to each rule contain vulnerable, safe and boundary fixtures plus malformed-input cases.
They were **written but not executed** in the change that introduced them; no benchmark was recorded and no
independent security review has taken place. Run `npx jest rules/security` before relying on them.
