# Server-Side Request Forgery (SSRF) Analysis

GasGuard's `SsrfAnalyzer` finds Server-Side Request Forgery vulnerabilities
([CWE-918](https://cwe.mitre.org/data/definitions/918.html)) across Node.js / TypeScript
and Python services. These include unvalidated outbound HTTP calls using user input,
weak or bypassable host checks, access to cloud metadata services, and disabled TLS verification.

| Layer | Location |
| --- | --- |
| Analyzer (engine) | `libs/engine/analyzers/ssrf/` |
| Worker job + persistence | `apps/api/src/scanner/ssrf-scan.job.ts` |
| Runtime protection | `src/security/ssrf.ts` |
| Fixtures (representative repos) | `tests/fixtures/ssrf/` |

## Rules

| Rule | Default severity | Detects |
| --- | --- | --- |
| `ssrf-001` Unvalidated HTTP request to user-controlled URL | high | Outbound HTTP requests (`fetch`, `axios`, `http.get`, `requests.get`, `urllib`) using request-derived URLs without safe allowlist validation. |
| `ssrf-002` Weak or bypassable SSRF URL validation | medium | Protocol-only prefix checks (`startsWith("http://")`) and unparsed substring checks (`indexOf`, `includes`) on URLs that can be bypassed by attacker subdomains or query parameters. |
| `ssrf-003` Access to cloud metadata or loopback address | critical | Outbound requests or URL configurations targeting internal loopback (`127.0.0.1`, `localhost`) or cloud metadata IP endpoints (`169.254.169.254`, `metadata.google.internal`). |
| `ssrf-004` Disabled TLS certificate verification in HTTP client | high | Insecure HTTP client options explicitly disabling TLS verification (`rejectUnauthorized: false`, `verify=False`). |

## Runtime Protection

GasGuard provides `validateUrlForSsrf` and `preventSsrf` in `src/security/ssrf.ts` to enforce:
- Scheme restrictions (`http:`, `https:`)
- DNS resolution of hostnames before issuing requests
- Rejection of private IPv4 (RFC 1918), link-local/metadata (`169.254.0.0/16`), loopback (`127.0.0.0/8`), carrier-grade NAT, and IPv6 unique local/link-local/loopback addresses
- Rejection of DNS rebinding attacks via custom agent wrapping

## Configuration Options

Options can be supplied under `AnalyzerConfig.options.ssrf`:
```json
{
  "options": {
    "ssrf": {
      "safeValidators": ["validateWebhookUrl"],
      "additionalSinks": ["myHttpClient.send"],
      "additionalSources": ["event.body.target"],
      "proximityLines": 10
    }
  }
}
```
