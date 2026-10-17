# Release Artifact Retention Policy

## GitHub Actions Artifacts

Temporary artifacts produced by release workflows are retained for 90 days. The release SBOM workflow sets `retention-days: 90` on its uploaded artifact. A test parses the workflow and fails if a release artifact upload omits or changes that retention period.

Temporary workflow artifacts are for verification and recovery during the release window; they are not the archival copy of a release.

The CLI release workflow also publishes Sigstore signature bundles and GitHub
build-provenance attestations for each standalone platform executable. The
workflow grants `id-token: write` and `attestations: write` only so the build
job can create these attestations. Release smoke jobs use read-only
`contents` and `attestations` permissions.

## Published Release Assets

Files attached to a published GitHub Release remain available for as long as that release exists. GasGuard does not automatically delete or expire published release assets. Repository maintainers handle release deletion or replacement through the normal release process.

### Verify CLI provenance

With GitHub CLI authenticated and the release asset downloaded, verify the
artifact against the repository's GitHub-hosted attestation:

```bash
gh attestation verify ./gasguard-linux-x64 --repo MDTechLabs/GasGuard
```

Use the matching platform executable path for other releases. The
`release-smoke` job runs this verification and executes `--help` and `version`
against each published platform binary. It requires GitHub Releases assets,
GitHub artifact attestations, the Actions `attestations: write` permission for
the build, and a runner with GitHub CLI available.

## Dependencies and Troubleshooting

This policy relies on GitHub Actions artifact retention, GitHub Releases
storage, GitHub artifact attestations, and GitHub CLI verification. If an
Actions artifact expires, retrieve the corresponding SBOM from the published
release assets. If assets are unavailable, verify the release was published
and that the workflow had `contents: write` permission. If attestation
verification fails, do not treat the binary as verified; check that it came
from the expected repository and release, and inspect the workflow run and
attestation permissions before republishing.