# Webhook Signature Rotation

`WebhookSignatureRotation` (`src/integrations/webhooks`) signs payloads with the
current secret and keeps the previous secret valid for verification during a grace
window, so receivers can roll over without dropping deliveries.

```typescript
const rotation = new WebhookSignatureRotation(secret, { graceMs: 24 * 60 * 60 * 1000 });
const header = rotation.sign(body);          // "sha256=<hex>"
rotation.rotate();                           // new random secret; old one valid until grace ends
rotation.verify(body, header);               // { valid, matched: 'current' | 'previous', reason? }
```

## Configuration

| Option    | Default | Notes                              |
| --------- | ------- | ---------------------------------- |
| `graceMs` | 24h     | Must be a non-negative number      |
| `now`     | `Date.now` | Clock injection for tests       |

## Failure semantics

- Secrets shorter than 16 characters, or a rotation to the same secret, throw and leave state unchanged.
- `verify` never throws: malformed signatures return `reason: 'malformed'`, wrong ones `reason: 'mismatch'`.
- Only one previous secret is retained; a second rotation drops the oldest.
- The previous secret is rejected from the grace deadline onward.
- Comparison is timing-safe. State is in-memory and per instance, so tenants must use separate instances.
- Backward compatible: the header format (`sha256=<hex>`) matches the existing `X-GasGuard-Signature`.
