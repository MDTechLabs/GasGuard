# Dependency Provenance Checks

> **Issue:** [#1104 — Add dependency provenance checks](https://github.com/MDTechLabs/GasGuard/issues/1104)  
> **Workstream:** Security Hardening  
> **Status:** Implemented

---

## Overview

Dependency provenance verification answers the question: *"Can we trust where this package came from?"*  
It goes beyond a vulnerability audit — it checks that each dependency:

1. Was downloaded from a known, trusted registry (npmjs.com, crates.io).
2. Carries an integrity hash (SRI for npm, SHA-256 checksum for Cargo) so the download can be verified.
3. Uses a strong hash algorithm (sha512 for npm; sha256 for Cargo).

Provenance checks protect against supply-chain attacks where a malicious actor publishes a package to a shadow registry, tricks a developer into using a custom registry, or tampers with a downloaded tarball.

---

## Module Location

```
libs/security/
├── index.ts                          # Re-exports all public symbols
└── provenance/
    ├── interfaces.ts                 # Types: ProvenanceRecord, ProvenanceViolation, …
    ├── dependency-provenance-checker.service.ts   # Main checker service
    ├── index.ts                      # Barrel export for the provenance sub-module
    └── __tests__/
        └── dependency-provenance-checker.spec.ts  # 26 unit tests
```

---

## Usage

### As a NestJS Provider

Register `DependencyProvenanceChecker` in any NestJS module:

```typescript
import { Module } from '@nestjs/common';
import { DependencyProvenanceChecker } from '@security/provenance';

@Module({
  providers: [DependencyProvenanceChecker],
  exports: [DependencyProvenanceChecker],
})
export class SecurityModule {}
```

Then inject and call it:

```typescript
@Injectable()
export class MySecurityService {
  constructor(private readonly provenance: DependencyProvenanceChecker) {}

  async checkDeps() {
    const result = await this.provenance.checkNpmLockfile('pnpm-lock.yaml', {
      failOnSeverity: 'high',
      requireRepositoryUrl: false,
    });

    if (!result.passed) {
      result.violations.forEach((v) => console.error(v.message));
      throw new Error('Dependency provenance check failed');
    }
  }
}
```

### As a Standalone CLI Script

```bash
# Check pnpm lockfile (default: looks for pnpm-lock.yaml or package-lock.json)
pnpm run provenance:check

# Check explicit files with JSON output
ts-node scripts/check-dependency-provenance.ts \
  --npm pnpm-lock.yaml \
  --cargo Cargo.lock \
  --fail-on high \
  --json

# Skip internal workspace packages
ts-node scripts/check-dependency-provenance.ts \
  --npm package-lock.json \
  --exclude "@gasguard/engine,@gasguard/rules"
```

#### CLI exit codes

| Code | Meaning |
|------|---------|
| `0`  | All checks passed (no violations at or above the fail threshold) |
| `1`  | One or more violations at or above the fail threshold |
| `2`  | Usage error / lockfile not found |

---

## Configuration Reference

All options are defined in `ProvenanceCheckerConfig`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `failOnSeverity` | `'critical' \| 'high' \| 'medium' \| 'low' \| 'info'` | `'high'` | Minimum severity that causes `passed = false` |
| `requireRepositoryUrl` | `boolean` | `false` | Flag packages without a source repository URL |
| `requireNpmAttestation` | `boolean` | `false` | Flag npm packages without a provenance attestation |
| `exclude` | `string[]` | `[]` | Package names to skip (e.g. internal monorepo packages) |
| `maxPackages` | `number` | unlimited | Cap the number of packages checked per run |

---

## Violation Severity Levels

| Severity | npm Example | Cargo Example |
|----------|-------------|---------------|
| `critical` | Missing `integrity` field | crates.io package missing `checksum` |
| `high` | Unknown registry host | Unrecognised source registry or malformed checksum |
| `medium` | Weak hash algorithm (sha1) | *(reserved for future checks)* |
| `low` | *(reserved)* | *(reserved)* |
| `info` | *(reserved)* | Path/workspace dependency (no verifiable source) |

Each violation includes a **remediation** message explaining how to fix it.

---

## CI Integration

A dedicated `dependency-provenance` job runs in `.github/workflows/ci.yml`:

```yaml
dependency-provenance:
  name: Dependency Provenance Checks
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run dependency provenance check (npm)
      run: ts-node scripts/check-dependency-provenance.ts --npm pnpm-lock.yaml --fail-on high
      continue-on-error: true
    - name: Run dependency provenance check (Cargo)
      run: ts-node scripts/check-dependency-provenance.ts --cargo Cargo.lock --fail-on high
      continue-on-error: true
```

Reports are uploaded as CI artifacts (`provenance-reports`) for audit trail purposes.

> **Note:** `continue-on-error: true` is used initially so existing CI pipelines are not broken while the team triages any pre-existing violations. Set to `false` once all violations are resolved.

---

## Checks Performed

### npm / pnpm Lockfiles

| Check | Violation Severity | Description |
|-------|--------------------|-------------|
| Registry host allowlist | `high` | `resolved` URL must be `registry.npmjs.org`, `*.npmjs.org`, or an allowlisted private registry |
| Integrity presence | `critical` | Every package must have an `integrity` field |
| Integrity algorithm | `medium` | Only `sha512` is accepted; `sha1` / `sha384` are flagged |

### Cargo.lock

| Check | Violation Severity | Description |
|-------|--------------------|-------------|
| Source presence | `info` | Packages without a `source` field (path deps) are noted |
| Source allowlist | `high` | Source must be `crates.io-index` or a `github.com` / `gitlab.com` git URL |
| Checksum presence | `critical` | crates.io packages must have a `checksum` field |
| Checksum format | `high` | Must be a valid 64-character hex string (SHA-256) |

### File Integrity Verification

The checker exposes `verifyFileIntegrity(filePath, sriHash)` for verifying downloaded
tarballs or build artifacts against their expected SRI hash:

```typescript
const ok = checker.verifyFileIntegrity('./dist/gasguard.js', 'sha512-abc…');
```

---

## Extending the Checker

To add support for a new ecosystem (e.g. Python/pip):

1. Add a new `Ecosystem` variant to `interfaces.ts`.
2. Implement a `checkPipLockfile()` method following the same pattern as `checkNpmLockfile()`.
3. Add unit tests in `__tests__/dependency-provenance-checker.spec.ts`.
4. Register the new check in `scripts/check-dependency-provenance.ts`.

---

## Related

- [SECURITY.md](../SECURITY.md) — Responsible disclosure process
- [README.md § Privilege Boundaries](../README.md#-privilege-boundaries) — Trust boundary documentation
- CI workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- Issue: [MDTechLabs/GasGuard#1104](https://github.com/MDTechLabs/GasGuard/issues/1104)
