# Log Redaction

Part of the **Security Hardening** workstream — resolves #1102.

GasGuard's centralized logging system (`src/logger`) redacts secrets from log
messages and metadata **before** entries reach any provider (console, files,
external drains). Redaction is **enabled by default**: no code changes are
required to benefit from it.

## Why

Log lines are frequently aggregated into shared systems (CloudWatch, Datadog,
`kubectl logs`, CI artifacts). Any secret that reaches a log line — an API key
in an error message, a password in request metadata — is effectively disclosed
to everyone with access to that drain. Redaction at the logging boundary is the
last reliable line of defence.

## How it works

`LogRedactionService` (`src/logger/log-redaction.ts`) applies two complementary
strategies:

| Strategy | Applies to | Example |
|---|---|---|
| **Sensitive-key matching** | Metadata keys only | `{ password: "hunter2" }` → `{ password: "[REDACTED]" }` |
| **Value pattern matching** | Messages and string values | `auth failed with Bearer abc123` → `auth failed with [REDACTED]` |

Key matching is case-insensitive and substring-based (`stripeApiKey` matches
`apikey`). Value patterns recognise common secret formats: `Bearer`/`Basic`
schemes, GitHub tokens (`ghp_…`), AWS access keys (`AKIA…`), Slack tokens
(`xox…`), JWTs, 64-char hex private keys, and Stellar secret keys (`S…`).
Stellar **public** keys (`G…`) and Ethereum addresses are intentionally *not*
redacted — they are public identifiers, and redacting them would destroy log
usefulness.

Redacted values are replaced with the `[REDACTED]` marker (`REDACTED_MARKER`).

### Guaranteed properties

- **Non-mutating** — input objects passed to the logger are never modified.
- **Fail closed** — if redaction itself throws, metadata is replaced with
  `{ redacted: true, reason: 'redaction-error' }` rather than emitted unverified.
- **Cycle-safe** — circular references become `'[Circular]'`; recursion is
  capped at depth 10, with deeper subtrees replaced by a depth marker.
- **Error-aware** — `Error` instances are reduced to `{ name, message }` and
  their message is pattern-redacted; stacks are dropped from metadata paths.

## Configuration

Redaction integrates with `LoggerConfig` (see `src/logger/logger.types.ts`):

| Option | Type | Default | Description |
|---|---|---|---|
| `enableRedaction` | `boolean` | `true` | Master switch. |
| `redactionExtraKeys` | `string[]` | `[]` | Extra case-insensitive key substrings to redact, merged over the built-in list. |
| `redactionAllowlist` | `string[]` | `[]` | Keys that must never be redacted; takes precedence over all key lists. |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `LOG_ENABLE_REDACTION` | `true` | Set to `false` only for local debugging. |
| `LOG_REDACTION_EXTRA_KEYS` | *(empty)* | Comma-separated extra key substrings, e.g. `walletMnemonic,vaultPin`. |
| `LOG_REDACTION_ALLOWLIST` | *(empty)* | Comma-separated keys to exempt, e.g. `passwordPolicy,tokenCount`. |

> **Operational guidance:** keep `LOG_ENABLE_REDACTION=true` in every shared
> environment. Disabling redaction in staging/production should require the
> same review as disabling TLS.

### Programmatic usage

```ts
import { LoggerService } from './logger';

const logger = LoggerService.getInstance();

// Uses configured defaults (redaction on):
logger.info('scan complete', { repositoryId: 'r-1', findings: 3 });

// The following is redacted automatically:
logger.error('auth failed', new Error('Bearer ghp_…'), {
  password: 'hunter2',
});
// → message: 'auth failed', error.message: 'auth failed', password: '[REDACTED]'
```

Direct use of the engine (custom key/value patterns):

```ts
import { LogRedactionService } from './logger/log-redaction';

const redactor = new LogRedactionService({
  extraPatterns: ['vaultPin'],              // metadata keys
  customPatterns: [/\bproj_\w+\b/g],        // value regexes
});

redactor.redactMessage('created proj_abc123');
redactor.redactMetadata({ vaultPin: '1234', userId: 7 });
```

Runtime updates after changing `LoggerConfig`:

```ts
configManager.updateConfig({ redactionExtraKeys: ['walletMnemonic'] });
LoggerService.getInstance().refreshRedactionConfig();
```

## Testing

The behaviour is locked in by two suites:

- `src/logger/__tests__/log-redaction.spec.ts` — unit tests: normal,
  boundary (nesting, cycles, depth, allowlists, defensive copies), and failure
  scenarios (disabled mode, hostile input, fail-closed behaviour).
- `src/logger/__tests__/logger-redaction-integration.spec.ts` — integration
  through `LoggerService` with a capturing provider: standard levels, `audit()`,
  error/fatal payloads, the real-time `log` event, provider failure, and the
  configuration plumbing.

```bash
npx jest src/logger/__tests__ --coverage
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A secret still appears in logs | Custom key not in the key list; value format not recognised | Add it via `LOG_REDACTION_EXTRA_KEYS` or `customPatterns`; consider reporting the format upstream so the default patterns can cover it. |
| Non-secret fields are being redacted | Overly broad key substring or value pattern | Add the exact key to `LOG_REDACTION_ALLOWLIST` (e.g. `passwordPolicy`). |
| Redaction "stopped working" | `LOG_ENABLE_REDACTION=false` or `setEnabled(false)` was called | Check environment/config; re-enable via `refreshRedactionConfig()`. |
| Metadata shows `{ redacted: true, reason: 'redaction-error' }` | Redaction threw while walking the object (e.g. exotic getter) | Inspect the object in application code; the logger failed closed to avoid leaks. |
| Metadata shows `[Circular]` / `max-depth-exceeded` | Input object contains cycles or nesting beyond depth 10 | Simplify the metadata structure before logging. |

## Scope and limitations

Redaction is deliberately conservative: it removes values it can *recognise*,
and cannot guarantee that arbitrary free-form strings are secret-free. Treat it
as defence in depth alongside code review and secrets scanning in CI — not as a
substitute for never passing credentials to the logger in the first place.
