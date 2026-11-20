# Oracle configuration and gas-forwarding rules

Four lexical Solidity detectors built on the shared toolkit in
[`rules/security/lib/solidity-lite.ts`](../../rules/security/lib/solidity-lite.ts). Each returns the normalized
`RuleResult` (`ruleId`, `analyzed`, `findings[]`, `diagnostics[]`, plus rule-specific extras); every finding has
`kind`, `severity`, `confidence`, `line`/`column`, `contract`/`function`, `message`, `severityRationale`,
`confidenceEvidence[]`, `remediation` and structured `details`.

| Rule id | Entry point | Source |
| --- | --- | --- |
| `GG-ORACLE-DECIMALS-001` | `detectOracleDecimalMismatch` | `rules/security/oracle/detect-oracle-decimal-mismatch.ts` |
| `GG-ORACLE-FALLBACK-001` | `detectFallbackOracleInconsistency` | `rules/security/oracle/detect-fallback-oracle-inconsistency.ts` |
| `GG-ORACLE-REPLACE-001` | `detectUnrestrictedOracleReplacement` | `rules/security/oracle/detect-unrestricted-oracle-replacement.ts` |
| `GG-GAS-FORWARD-001` | `detectGasForwardingAssumptions` | `rules/security/external-calls/detect-gas-forwarding-assumptions.ts` |

## Supported input and general limitations

- Solidity source text, compiler versions 0.6 – 0.8.x (pre-0.7 `call.gas()` syntax is understood by the gas rule).
  Compiler settings and the EVM version are never consulted.
- One source string at a time; inherited bases, other files, libraries, external contracts and runtime
  configuration are **not** resolved. Analysis is lexical and intra-function.
- No repository script is executed and no project configuration is trusted; options are plain arguments.
- Malformed or unsupported input never throws: non-strings, empty input, input over 1,000,000 characters and text
  with no `contract`/`library`/`interface` return `analyzed: false` with an `error` diagnostic. Unbalanced
  delimiters produce an `unbalanced-delimiters` warning and analysis continues on what could be parsed.
- Asset, decimals and role semantics are inferred from identifier names; treat every verdict as a prompt for review.

## GG-ORACLE-DECIMALS-001 — decimal mismatch in multi-feed calculations

Finds statements that multiply/divide values read from two or more different feeds and checks for scale handling.

| `kind` | Meaning |
| --- | --- |
| `unnormalized-feed-decimals` | No decimals query, scale factor or normalized operand at all. Confidence is `high` when feed decimals are statically known and differ, `medium` when known and equal (products), `low` when unknown. A ratio of feeds with equal known decimals is not reported (the scales cancel). |
| `partial-normalization` | Some operands were rescaled and at least one was not. |
| `literal-scale-with-mixed-decimals` | Advisory: a literal factor (`/ 1e8`) over feeds with different known decimals; the finding states the resulting precision. |

**Expected vs observed scale** — where decimals are statically determinable, `details.expectedResultScaleExponent`
is the exponent of ten of the raw result (`a * b` → `da + db`, `a / b` → `da - db`) and
`details.appliedScaleExponent` the sum of literal scale factors in the statement (`null` if scale factors are dynamic).
Decimals are resolved from `<NAME>_DECIMALS` constants whose name overlaps the feed identifier (e.g. `ETH_USD_DECIMALS`
↔ `ethUsdFeed`) or from the `feedDecimals` option. `feed.decimals()` calls count as normalization evidence only —
their runtime values are unknown.

**Limitations / false positives:** a literal factor that happens to fit one feed pair is accepted as normalization
(only reported as an advisory when decimals are known); normalization performed inside called helpers is recognized
only by name (`normalize`, `toWad`, `scale`, ...); stablecoin, collateral and cross-rate fixtures cover the common shapes.

## GG-ORACLE-FALLBACK-001 — fallback oracle paths

Detects a primary read followed by a fallback read in a `catch`, `else` or `if` block and compares the two paths:

- `fallback-quote-asset-mismatch` — different quote assets (ETH/USD vs ETH/EUR) from the feed identifiers.
- `fallback-inversion-mismatch` — an inverse-orientation feed (USD/ETH vs ETH/USD) not inverted in code, or inversion on one path only.
  `1e36 / price` style numerators are inversion, not decimals scaling.
- `fallback-decimals-mismatch` — one path rescales (decimals(), `10 ** n`, `1eN`) and the other does not, or the literal scales differ.
  **Explicit adapter normalization** (both paths call a `normalize`/`toWad`/`scale` helper) suppresses it.
- `fallback-stale-policy-mismatch` — staleness checked on the primary only (high) or with different thresholds (medium).

`details.sharedSink` records whether both paths assign the same variable or return (the "same downstream calculation").
**Limitations:** asset semantics come from names; feeds configured in other contracts are not resolved; fallbacks
implemented across functions are not followed. Two feeds combined unconditionally are not a fallback (see the decimals rule).

## GG-ORACLE-REPLACE-001 — oracle and adapter replacement

For each oracle/feed/adapter state variable (plain, or a mapping such as `feeds[token]`) the rule evaluates the
functions that assign it (or a `pending…` staging variable):

- **Authorization** — restrictive modifiers (`onlyOwner`, `onlyRole(R)`, `auth`, ... resolved against modifier bodies in
  the same file; non-restrictive ones such as `whenNotPaused` are ignored), inline `msg.sender` comparisons against
  non-parameter values, `_checkOwner`/`_checkRole`/`hasRole`. Roles named by `onlyRole(R)` are listed with the places they
  are granted in constructors/initializers (`roleGrants`). Modifiers from inherited bases are recognized by name; when
  the contract does not inherit a known access-control base the finding's confidence drops to `medium`.
- **Delay** — a propose → apply flow (staged `pending*` variable) or a timestamp gate.
- **Validation** — probing the new source (`decimals()`, `latestRoundData()`, `description()`, asset/interface calls,
  `code.length > 0`). A zero-address check alone is not validation.
- **Emergency policy** — `emergency…`/guardian paths waive the delay requirement (extend with `emergencyPolicies`).

| `kind` | Condition |
| --- | --- |
| `unrestricted-oracle-replacement` | No access control; critical if a financial function in the file reads the oracle, otherwise high. |
| `immediate-privileged-replacement` | Restricted, but immediate and unvalidated (medium). |
| `privileged-replacement-no-delay` / `replacement-without-validation` | One of delay or validation is missing (low). |

Each finding reports the privileged path (`details.privilegedPath`, `roles`) and the downstream dependents
(`details.dependents`). **Limitations:** who actually holds a role at runtime and what governance contract sits behind
`onlyOwner` are not visible; dependents are same-file functions that read the variable and look financial.

## GG-GAS-FORWARD-001 — gas-forwarding assumptions

Inventories `address.transfer/send` (implicit 2300-gas stipend) and `call/staticcall/delegatecall` with an explicit
`gas:` cap and traces what happens when the recipient needs more gas:

- `stipend-transfer` — fixed stipend. `msg.sender` recipient → low; third party → medium; third party in a loop → high
  (one reverting recipient blocks all others). A handled `send` failure is low.
- `fixed-gas-cap-reverts-on-failure` — a gas cap (literal, constant or computed) whose failure reverts the caller.
- `unchecked-low-level-send` — failure ignored; high when state was already updated as if the payment succeeded.
- `intentional-gas-cap` (low) — a cap with failure handled without reverting (e.g. credited to a pull-payment balance).

`callSites` lists every call with recipient kind, gas expression, failure handling (`reverts` / `handled` / `ignored`),
loop membership and the number of contract-state writes before and after it. ERC-20 `transfer(to, amount)` (two
arguments) and calls that forward all gas are ignored. `RECIPIENTS` in the fixtures file documents recipient fallbacks
with different gas needs (emit-only, one storage write, forwarding to another contract); the gas figures are rough
post-Istanbul estimates, not measurements.
**Limitations:** recipient code is never visible, so whether a cap is actually too low cannot be decided statically;
failure handling is followed within the same function only.

## Verification evidence

Specs and fixtures sit next to each rule (vulnerable, safe, boundary and malformed-input cases). They were **written but
not executed** in the change that introduced them; no benchmark was recorded and no independent security review has
taken place. Run `npx jest rules/security` before relying on them.
