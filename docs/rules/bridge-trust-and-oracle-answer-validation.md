# Bridge trust and oracle answer validation rules

Four lexical Solidity detectors built on the shared toolkit in
[`rules/security/lib/solidity-lite.ts`](../../rules/security/lib/solidity-lite.ts). Each returns the normalized
`RuleResult` (`ruleId`, `analyzed`, `findings[]`, `diagnostics[]`); every finding has `kind`, `severity`,
`confidence`, `line`/`column`, `contract`/`function`, `message`, `severityRationale`, `confidenceEvidence[]`,
`remediation` and rule-specific `details`.

| Rule id | Entry point | Source |
| --- | --- | --- |
| `GG-XCHAIN-DUPID-001` | `detectDuplicateMessageIdentifiers` | `rules/security/bridge-trust/detect-duplicate-message-identifiers.ts` |
| `GG-XCHAIN-METADATA-001` | `detectRelayerSuppliedMetadata` | `rules/security/bridge-trust/detect-relayer-supplied-metadata.ts` |
| `GG-XCHAIN-FINALITY-001` | `detectMissingFinalityAssumptions` | `rules/security/bridge-trust/detect-missing-finality-assumptions.ts` |
| `GG-ORACLE-ANSWER-001` | `detectUnvalidatedOracleAnswers` | `rules/security/oracle/detect-unvalidated-oracle-answers.ts` |

## Supported input and general limitations

- Solidity source text, compiler versions 0.6 – 0.8.x. Compiler settings are never consulted.
- One source string at a time; inherited bases, other files, libraries and external contracts are **not**
  resolved. Analysis is lexical and intra-function (plus one level of same-file helper calls where stated).
- No repository script is executed and no project configuration is trusted; options are plain arguments.
- Malformed or unsupported input never throws: non-strings, empty input, input over 1,000,000 characters and
  text with no `contract`/`library`/`interface` return `analyzed: false` with an `error` diagnostic.
  Unbalanced delimiters produce an `unbalanced-delimiters` warning and analysis continues on what could be parsed.
- Static analysis cannot prove safety; names (endpoint, nonce, version, finality, ...) drive recognition.

## GG-XCHAIN-DUPID-001 — duplicate execution under alternate identifiers

Compares how the consumed-message id is built with what the handler executes.

| `kind` | Meaning |
| --- | --- |
| `caller-supplied-message-id` | The replay key is a parameter, not recomputed from the message (skipped when an authenticated endpoint supplies it, or when the id is checked against a recomputed `keccak256`). |
| `raw-payload-identity` | Key is `keccak256(rawPayload)` while decoded fields are executed; padded, trailing-byte and alternate-offset encodings of the same fields hash differently (`abi.decode` accepts them). |
| `id-includes-unexecuted-fields` | The preimage contains fields execution ignores (e.g. `salt`): varying them yields new ids for the same effect. Domain/sender/nonce/id fields are exempt. |
| `id-omits-executed-fields` | Executed fields are missing from the preimage; one id can stand for different messages. |
| `non-canonical-id-encoding` | `abi.encodePacked` over two or more dynamic operands. |
| `id-not-domain-bound` | No chain/domain/eid/`address(this)` in the preimage. |

Field comparison is order-insensitive, so re-ordering the same fields is accepted. **Limitations:** field sets
are compared by identifier name; ids built in other functions or contracts are not followed; unchecked
alternate encodings that `abi.decode` itself rejects (dirty high bits in 0.8 ABIEncoderV2) are reported anyway.

## GG-XCHAIN-METADATA-001 — relayer-supplied source metadata

Tracks `calldata → (aliases) → authorization / mint` for source chain, remote sender and proof metadata.

- `spoofable-source-metadata`: metadata taken from parameters (or decoded from a caller-supplied payload) is
  used in a trust decision (`require(trustedRemotes[srcChain] == sender)`) and/or in mint-style effects, and
  the function does not authenticate the messaging endpoint. Critical when both an access decision and value
  effects are reached.
- `proof-not-verified`: a `proof`/`signature` parameter is accepted but never passed to a verification call
  before crediting value.
- **Recognized as safe:** receivers that authenticate the caller as the endpoint (inline comparison,
  `onlyEndpoint`-style modifier names, or a modifier body that compares `msg.sender` with an endpoint-like
  address). They are listed in `authenticatedReceivers`. This is name-based; it does not prove the stored
  endpoint address is correct.
- **False positives:** custom authentication via helper calls the rule cannot see.
- `metadataNames` extends the parameter-name patterns.

## GG-XCHAIN-FINALITY-001 — finality assumptions

For handlers that consume source-chain events or proofs:

- `missing-finality-policy`: the handler (application-managed) acts without a confirmation-depth or finality
  condition. Confidence is higher when it verifies a proof itself.
- `finality-delegated-to-transport` (low): a known framework receiver behind an authenticated endpoint relies on
  the transport's per-chain configuration — an assumption, not a verified guarantee.
- `finality-config-unbounded` (low): a setter for `requiredConfirmations`-style configuration has no lower bound.
- `single-finality-policy-for-multiple-chains` (low): one scalar depth is applied to events from several chains.
- `finalityConfig` in the result lists discovered configuration variables/mappings, their setters and whether
  the setter validates its input; findings carry `details.assumptions`.

**The rule cannot independently verify off-chain finality services** (relayers, DVN/oracle networks, guardian
sets, light clients). A confirmation constant in storage is only meaningful if the chain-specific value
configured for it is correct. Treat every finding as a prompt to review that configuration, not as proof.

## GG-ORACLE-ANSWER-001 — oracle answer validation

For `latestRoundData`/`getRoundData` consumers whose answer reaches financial logic:

| `kind` | Condition |
| --- | --- |
| `missing-answer-sign-check` | No `answer > 0`-style check (zero and negative answers pass). |
| `weak-answer-sign-check` | Only `>= 0`, `!= 0`, `== 0` or `< 0` (one of zero/negative still passes). |
| `missing-round-completeness-check` | Neither `answeredInRound >= roundId` nor an `updatedAt` zero check. |
| `missing-staleness-check` | `updatedAt` discarded or never compared with `block.timestamp`/a heartbeat. |
| `deprecated-latest-answer` | `latestAnswer()` gives no timestamp or round id. |
| `unvalidated-adapter-price` | Custom adapter result (`getPrice`, ... plus `adapterMethods`) used with no zero check or freshness handling; **low confidence**, adapter behavior is unknown. |

Not flagged: sequencer-uptime feeds (names matching `sequencer`/`uptime`) and answers that are only compared or
emitted. **Limitations:** validation inside called helpers/modifiers is not seen; heartbeat suitability per feed
cannot be judged; `answeredInRound` is considered deprecated by some feed providers, so `updatedAt != 0` is accepted
as the completeness check.

## Verification evidence

Specs and fixtures sit next to each rule (vulnerable, safe, boundary and malformed-input cases). They were
**written but not executed** in the change that introduced them; no benchmark was recorded and no independent
security review has taken place. Run `npx jest rules/security` before relying on them.
