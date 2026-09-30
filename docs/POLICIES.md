# GasGuard Policy & Governance: Exceptions & Approvals

GasGuard policies enforce strict security and gas limits on transactions. In cases requiring operational flexibility, administrators can issue time-limited policy exceptions.

## Exception Lifecycle
1. **Request**: A user submits an exception request via the governance API specifying the policy ID, wallet, and justification.
2. **Review**: Administrators review and approve or reject the request (`POST /api/policies/exceptions/:id/review`).
3. **Execution**: Once approved, transactions violating the target policy will successfully bypass the block within the configured TTL window (default: 24 hours), attaching the `X-Policy-Exception-Applied: true` header.