# Audit Module

Comprehensive audit logging system for GasGuard providing traceability and accountability for all critical actions.

## Quick Summary

- **Purpose**: Track all API requests, API key lifecycle events, and gas transactions
- -**Storage**: PostgreSQL with immutable append-only logs
- **Access**: REST API endpoints with admin-only access
- **Export**: CSV and JSON export capabilities
- -**Integrity**: SHA256 hashing for tamper-detection

## Key Files

### Entities
- `entities/audit-log.entity.ts` - Main audit log entity with event tracking
- `entities/api-key.entity.ts` - API key management and lifecycle tracking

### Services
- `services/audit-log.service.ts` - Main service for querying and emitting audit events
- `services/audit-log.repository.ts` - Database repository for audit logs
- `services/audit-event-emitter.ts` - EventEmitter for decoupled event handling

### API Layer
- `controllers/audit.controller.ts` - REST endpoints for querying and exporting logs
- `interceptors/audit.interceptor.ts` - Global request interceptor for automatic API logging
- `dto/audit-log.dto.ts` - Data transfer objects for API requests/responses

### Module
- `audit.module.ts` - NestJS module configuration
- `index.ts` - Public API exports

### Tests
- `services/__tests__/audit-log.service.spec.ts` - Service unit tests (70%+ coverage)
- `services/__tests__/audit-event-emitter.spec.ts` - Event emitter tests
- `interceptors/__tests__/audit.interceptor.spec.ts` - Interceptor tests
- `__tests__/audit.controller.e2e.spec.ts` - Integration/E2E tests

### Documentation
- Root docs: `AUDIT_LOGGING_SYSTEM.md` - Comprehensive system documentation
- Root docs: `AUDIT_INTEGRATION_GUIDE.md` - Integration and usage guide
- Examples: `examples/audit-integration.example.ts` - Code examples

## Event Types

```typescript
enum EventType {
  API_REQUEST = 'APIRequest',              // All API requests
  API_KEY_CREATED = 'KeyCreated',          // New API key creation
  API_KEY_ROTATED = 'KeyRotated',          // Key rotation
  API_KEY_REVOKED = 'KeyRevoked',          // Key revocation
  GAS_TRANSACTION = 'GasTransaction',      // Gas transactions
  GAS_SUBMISSION = 'GasSubmission',        // Gas submissions
}
```

## Database Schema

### audit_logs Table
Immutable, append-only log storage with:
- Composite index on (eventType, user, timestamp) for fast queries
- Individual indexes on eventType, user, timestamp, chainId
- JSONB field for flexible event-specific details
- SHA256 integrity field for tamper detection

### api_keys Table
API key lifecycle tracking with:
- Merchant association
- Status tracking (active, rotated, revoked, expired)
- Key hash storage (never stores raw keys)
- Rotation chain via rotatedFromId

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/audit/logs` | Query logs with filtering |
| GET | `/audit/logs/:id` | Get specific log |
| GET | `/audit/logs/type/:eventType` | Filter by event type |
| GET | `/audit/logs/user/:userId` | Filter by user |
| POST | `/audit/logs/export` | Export as CSV/JSON |
| GET | `/audit/stats` | Get statistics |

## Auto-Logging

The `AuditInterceptor` automatically logs all API requests including:
- API key extraction (Authorization header, X-API-Key, query param)
- Endpoint and HTTP method
- Response status and duration
- IP address
- Error messages on failures
- Excludes: /health, /metrics, /swagger, /api-docs

## Privilege Boundary

The audit module operates across three privilege tiers. Understanding these boundaries is required when extending the module or integrating new consumers.

| Tier | Actor | Allowed operations | Forbidden operations |
|------|-------|--------------------|--------------------|
| T0 - Public | Unauthenticated client | None (audit endpoints require auth) | Read or write any audit record |
| T1 - Authenticated | API key holder (role: `user`) | Emit own audit events via interceptor; query own logs via scoped filters | Read other merchants' logs; export global data; delete or mutate logs |
| T2 - Admin | API key holder (role: `admin`) | Query all logs, export CSV/JSON, read stats, manage API key lifecycle | Mutate or delete existing log records; disable integrity hashing |

### Enforcement points

- `AuditController` guards every route with the admin role guard. There is no route that serves audit data to a T0 or T1 actor directly.
- `AuditInterceptor` runs after authentication and attributes every event to the authenticated principal. It never trusts a client-supplied user identifier.
- `AuditLogRepository` exposes only append and read operations. Update and delete are not implemented and must not be added.
- The `SHA256` integrity digest is computed inside the service layer from the persisted record. Calling code cannot override it.
- Export endpoints are admin-only and are rate-limited to prevent bulk exfiltration.

### Trust boundaries

- The audit module trusts the authentication layer to verify API keys and attach a role. It does not re-verify keys itself.
- The audit module does not trust any client-supplied field used for authorization decisions (user id, merchant id, role).
- The audit module does not trust downstream consumers to preserve immutability; enforcement is at the repository layer.
- The audit module does not trust the database role to reject mutations. The application role must be granted only `INSERT | SELECT` on `audit_logs`.

### Cross-component dependencies

- Authentication guard must attach a role to the request before `AuditInterceptor` runs. If the role is missing, the interceptor records the event as `unauthenticated` and does not elevate privileges.
- Database migrations must grant only `INSERT` and `SELECT` on `audit_logs` to the application role. Review this grant in any migration that touches the audit schema.
- Export consumers (dashboards, reporting jobs) must authenticate as admin. There is no service-to-service bypass.
- Any new event type must be added to the `EventType` enum and covered by the admin-only query path. Events that carry sensitive data must document their redaction rules.

## Usage Examples

### Emit API Key Event
```typescript
auditLogService.emitApiKeyEvent(
  EventType.API_KEY_CREATED,
  'merchant_123',
  { keyId: 'key_1', name: 'Production Key', role: 'user' }
);
```

### Emit Gas Transaction
```typescript
auditLogService.emitGasTransaction(
  'merchant_123',
  1, // chainId
  '0x1234...', // txHash
  21000, // gasUsed
  '45 gwei', // gasPrice
  '0xabcd...', // senderAddress
  { method: 'transfer', value: '1.5' }
);
```

### Query Logs
```typescript
const logs = await auditLogService.queryLogs({
  eventType: EventType.API_REQUEST,
  user: 'merchant_123',
  from: '2024-02-01',
  to: '2024-02-28',
  limit: 50,
  offset: 0,
});
```

### Export Logs
```typescript
const csv = await auditLogService.exportLogs('csv', {
  eventType: EventType.API_REQUEST,
  user: 'merchant_123',
});
```

## Setup Instructions

1. **Database Migration**
   ```bash
   npm run migration:run
   ```

2. **Verify Integration**
   - Check `AppModule` imports `AuditModule` ✓
   - Check `main.ts` registers `AuditInterceptor` ✓
   - Check database has `audit_logs` and `api_keys` tables

3. **Test**
   ```bash
   npm test -- audit
   npm run test:cov -- src/audit
   ```

## Security Features

- ✅ API key hashing (never stores raw keys)
- ✅ Immutable append-only logs
- ✅ SHA256 integrity hashing
- ✅ Admin-only access (configurable)
- ✅ Automatic request capture via interceptor
- ✅ Audit trail for all key operations
- ✅ Multi-chain support
- ✅ Privilege boundaries documented and enforced at the controller and repository layers

## Performance

- Composite indexes for fast querying
- Pagination support for large result sets
- Configurable retention policies
- Query execution optimized via indexes
- Async event emission (non-blocking)

## Compliance

Maps to requirements: SOX, GDPR, HIPAA, PCI-DSS
- User activity tracking ✅
- Access control logging ✅
- Change audit trail ✅
- Data retention policies ✅
- Export for external audit ✅

## Testing Coverage

- Unit tests for all services (70%+ coverage)
- Integration tests for API endpoints
- Event emitter tests
- Interceptor tests
- End-to-end tests

Run tests:
```bash
npm test -- audit
npm run test:cov -- src/audit
npm run test:e2e -- audit.controller.e2e.spec.ts
```

## Troubleshooting

| Symptom | Likely cause | Resolution |
|--------|-------------|------------|
| Audit logs missing for a route | Route excluded by interceptor or interceptor not registered in `main.ts` | Confirm the route is not in the exclusion list and that `AuditInterceptor` is bound globally |
| `403` on `/audit/logs` | Caller is not admin | Authenticate with an admin API key; T1 keys cannot query audit data |
| Integrity check fails for a record | Record mutated outside the application or digest computed with a different normalization | Treat as a tamper incident; review database grants and audit the `audit_logs` table access paths |
| Export times out for large ranges | Unbounded query window | Narrow the `from`/`to` range or paginate; export endpoints are rate-limited |
| API key events not recorded | Event emitter not injected into the calling service | Inject `AuditEventEmitter` and confirm the caller awaits the emit call |

## Future Enhancements

- [ ] Elasticsearch integration for large-scale queries
- [ ] Real-time log streaming via WebSockets
- [ ] Advanced analytics dashboard
- [ ] Automated compliance report generation
- [ ] Log encryption at rest
- [ ] Prometheus metrics export
- [ ] Anomaly detection via ML

## Related Documentation

- [AUDIT_LOGGING_SYSTEM.md](../../docs/AUDIT_LOGGING_SYSTEM.md) - Full system documentation
- [AUDIT_INTEGRATION_GUIDE.md](../../docs/AUDIT_INTEGRATION_GUIDE.md) - Integration guide with examples
