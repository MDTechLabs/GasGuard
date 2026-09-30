# GasGuard Policy & Governance: Exceptions & Approvals

GasGuard policies enforce strict security and gas limits on transactions. In cases requiring operational flexibility, administrators can issue time-limited policy exceptions.

## Exception Lifecycle
1. **Request**: A user submits an exception request via the governance API specifying the policy ID, wallet, and justification.
2. **Review**: Administrators review and approve or reject the request (`POST /api/policies/exceptions/:id/review`).
3. **Execution**: Once approved, transactions violating the target policy will successfully bypass the block within the configured TTL window (default: 24 hours), attaching the `X-Policy-Exception-Applied: true` header.

# GasGuard Policy & Governance: Version Pinning

To maintain deterministic and reproducible security evaluations across contract deployments and audits, GasGuard supports **Policy Version Pinning**.

## Usage
Clients can pin their requests to a specific policy version by supplying the `X-Policy-Version` HTTP header or including `policyVersion` in the transaction payload.

* **Pinned Execution**: Ensures that even if upstream policy definitions are updated or superseded by newer versions, historical or verified transactions continue to evaluate against their intended immutable version.
* **Unpinned Execution**: Omission of the version specifier automatically evaluates against the `latest` registered version.