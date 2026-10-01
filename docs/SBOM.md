# GasGuard Software Bill of Materials (SBOM)

This document describes the generation, verification, and distribution of Software Bill of Materials (SBOM) for the GasGuard protocol and CLI tools.

## Overview

To fulfill supply-chain security standards and mainnet-readiness criteria, GasGuard produces automated SBOMs covering:
1. **Node.js / TypeScript Workspaces**: Root package, CLI tooling, and SDK libraries.
2. **Rust Engine & Soroban Smart Contracts**: Core gas evaluation logic and WASM contracts.

## Supported Formats

- **SPDX 2.3 JSON**: International standard (ISO/IEC 5962:2021) for software packaging and license compliance.
- **CycloneDX 1.5 JSON**: OWASP flagship standard designed for application security and vulnerability identification.

## Release Integration

SBOM generation is automated via GitHub Actions in [`.github/workflows/release-sbom.yml`](../.github/workflows/release-sbom.yml):
- **Triggers**: On GitHub Release publish, version tag push (`v*`), or manual `workflow_dispatch`.
- **Release Assets**: Attached directly to the GitHub release as downloadable JSON artifacts.
- **Workflow Artifacts**: Retained in GitHub Actions runs for 90 days.

## Local Generation

To generate SBOMs locally:

```bash
# Generate SBOM artifacts to default directory (./sbom-output)
bash scripts/generate-sbom.sh

# Or specify a custom output directory
bash scripts/generate-sbom.sh ./dist/sbom
```

## Verification

Validate the generated JSON artifacts:

```bash
# Check SPDX JSON format
jq .spdxVersion sbom-output/gasguard-node-sbom.spdx.json

# Check CycloneDX format
jq .bomFormat sbom-output/gasguard-sbom.cyclonedx.json
```
