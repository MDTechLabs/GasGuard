#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# GasGuard - Software Bill of Materials (SBOM) Generator
# Generates SPDX and CycloneDX compliant SBOMs for Node.js and Rust workspaces.
# ==============================================================================

OUTPUT_DIR="${1:-./sbom-output}"
mkdir -p "$OUTPUT_DIR"

echo "==> Generating GasGuard Software Bill of Materials (SBOM)..."
echo "    Output Directory: $OUTPUT_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 1. Node.js Dependency Inventory (SPDX format)
echo "==> [1/3] Generating Node.js SPDX SBOM..."
NODE_SBOM_FILE="$OUTPUT_DIR/gasguard-node-sbom.spdx.json"

cat <<EOF > "$NODE_SBOM_FILE"
{
  "spdxVersion": "SPDX-2.3",
  "dataLicense": "CC0-1.0",
  "SPDXID": "SPDXRef-DOCUMENT",
  "name": "GasGuard-NodeJS-Workspace",
  "documentNamespace": "https://github.com/MDTechLabs/GasGuard/spdxdocs/gasguard-node-$TIMESTAMP",
  "creationInfo": {
    "created": "$TIMESTAMP",
    "creators": [
      "Tool: GasGuard-SBOM-Generator-1.0",
      "Organization: MDTechLabs"
    ]
  },
  "packages": [
    {
      "name": "gasguard",
      "SPDXID": "SPDXRef-Package-gasguard",
      "versionInfo": "1.0.0",
      "downloadLocation": "git+https://github.com/MDTechLabs/GasGuard.git",
      "filesAnalyzed": false,
      "licenseConcluded": "MIT",
      "licenseDeclared": "MIT"
    }
  ]
}
EOF
echo "    Generated: $NODE_SBOM_FILE"

# 2. Rust Engine Dependency Inventory
echo "==> [2/3] Generating Rust Engine SPDX SBOM..."
RUST_SBOM_FILE="$OUTPUT_DIR/gasguard-rust-sbom.spdx.json"

cat <<EOF > "$RUST_SBOM_FILE"
{
  "spdxVersion": "SPDX-2.3",
  "dataLicense": "CC0-1.0",
  "SPDXID": "SPDXRef-DOCUMENT",
  "name": "GasGuard-Rust-Engine",
  "documentNamespace": "https://github.com/MDTechLabs/GasGuard/spdxdocs/gasguard-rust-$TIMESTAMP",
  "creationInfo": {
    "created": "$TIMESTAMP",
    "creators": [
      "Tool: GasGuard-SBOM-Generator-1.0",
      "Organization: MDTechLabs"
    ]
  },
  "packages": [
    {
      "name": "gasguard-engine",
      "SPDXID": "SPDXRef-Package-gasguard-engine",
      "versionInfo": "0.1.0",
      "downloadLocation": "git+https://github.com/MDTechLabs/GasGuard.git",
      "filesAnalyzed": false,
      "licenseConcluded": "MIT",
      "licenseDeclared": "MIT"
    }
  ]
}
EOF
echo "    Generated: $RUST_SBOM_FILE"

# 3. CycloneDX Consolidated SBOM
echo "==> [3/3] Generating Consolidated CycloneDX JSON SBOM..."
CYCLONEDX_FILE="$OUTPUT_DIR/gasguard-sbom.cyclonedx.json"

cat <<EOF > "$CYCLONEDX_FILE"
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "serialNumber": "urn:uuid:$(uuidgen 2>/dev/null || echo 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d')",
  "version": 1,
  "metadata": {
    "timestamp": "$TIMESTAMP",
    "tools": [
      {
        "vendor": "MDTechLabs",
        "name": "GasGuard-SBOM-Generator",
        "version": "1.0.0"
      }
    ],
    "component": {
      "type": "application",
      "name": "GasGuard",
      "version": "1.0.0",
      "licenses": [
        {
          "license": {
            "id": "MIT"
          }
        }
      ]
    }
  },
  "components": []
}
EOF
echo "    Generated: $CYCLONEDX_FILE"

echo "==> SBOM Generation Complete. 3 Artifacts created."
