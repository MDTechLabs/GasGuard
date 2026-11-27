# ERC-2771 trusted-forwarder assumptions

Rule ID: `erc2771-trusted-forwarder`

Entry point: `detectErc2771TrustedForwarder` in
[`rules/security/proxy/detect-erc2771-trusted-forwarder.ts`](../../rules/security/proxy/detect-erc2771-trusted-forwarder.ts).

This detector uses the shared Solidity source sanitizer and lexical helpers. It does not invoke
Solidity compilers, inspect AST/IR, execute repository code, or run package/build scripts.

## Supported input and limitations

- Solidity 0.8.x source text, one source file per analysis. A `pragma` is not used to select a
  parser or compiler; the rule does not validate compiler compatibility.
- Inheritance is followed only for bases defined in the same file. Direct base names
  `ERC2771Context` and `ERC2771ContextUpgradeable` are recognized; imported bases and aliases
  cannot be resolved.
- Access-control modifiers and trusted-forwarder checks are recognized by name/pattern, not by
  semantic execution. Custom validation may be missed, and a matching but incorrect check may
  suppress a finding.
- Dynamic forwarder configuration, constructor configuration, and trust decisions in other
  contracts are not evaluated. Findings are review prompts, not proof of exploitability.
- Malformed or oversized source is returned through the shared validation diagnostics without
  throwing. Repository hooks are never executed.

## Findings

| Finding | Severity | Meaning |
| --- | --- | --- |
| `Calldata sender suffix is not authenticated` | High | A custom `_msgSender()` reads a sender from the calldata tail without a visible check that `msg.sender` is trusted. |
| `Raw msg.sender used with ERC-2771 context` | Medium | An externally callable function in a same-file `ERC2771Context` descendant uses raw `msg.sender` in a require/assert/if authorization comparison. The check may compare to a trusted forwarder intentionally. |
| `Trusted forwarder can be changed without authorization` | High | An externally callable function whose name mentions forwarder assigns `trustedForwarder` without a recognizable authorization modifier or owner/role check. |

Use `_msgSender()` when checking the end-user identity of a potentially forwarded call.
Authenticate the raw caller before decoding the appended sender, and protect any mutable
forwarder configuration. Review findings against the actual forwarder implementation and
deployment configuration to avoid treating intentional forwarder-only checks as end-user checks.

The focused specs are in
[`rules/security/proxy/__tests__/detect-erc2771-trusted-forwarder.spec.ts`](../../rules/security/proxy/__tests__/detect-erc2771-trusted-forwarder.spec.ts).
They were not executed as requested.
