# Audit Logging System Documentation

## Overview

The GasGuard Audit Logging System provides comprehensive traceability and accountability for all critical actions in the platform. It captures and stores immutable logs of API requests, key management events, and gas transactions, enabling full visibility and compliance readiness.

## Features

- **Event Tracking**: Captures API requests, API key lifecycle events, and gas transactions
- **Immutable Storage**: Append-only logs with integrity verification via cryptographic hashing
- **Query & Filtering**: Advanced filtering by event type, user, date range, and more
- **Export Capabilities**: Export logs as CSV or JSON for compliance reporting
- **Retention Policies**: Configurable log retention with automatic cleanup
- **Access Control**: Admin-only access to audit logs (production implementations)
- **Multi-chain Support**: Track events across multiple blockchain networks
- **Performance Optimized**: Strategic indexing for efficient querying

## Event Types

### 1. API Request (`APIRequest`)
Logged for every API endpoint access.

**Fields:**
- `apiKey`: The API key used for the request
- `endpoint`: The API endpoint accessed (e.g., `/scanner/scan`)
- `httpMethod`: HTTP method (GET, POST, PUT, DELETE, etc.)
- `responseStatus`: HTTP response code
- `ipAddress`: Client IP address
- `responseDuration`: Request processing time in milliseconds
- `outcome`: Success/Failure/Warning
- `errorMessage`: Error message if failed

**Example:**
```json
{
  "eventType": "APIRequest",
  "timestamp": "2024-02-23T10:30:00Z",
  "apiKey": "sk_prod_abc123def456",
  "endpoint": "/scanner/scan",
  "httpMethod": "POST",
  "responseStatus": 200,
  "ipAddress": "192.168.1.100",
  "responseDuration": 250,
  "outcome": "success"
}
```

### 2. API Key Created (`KeyCreated`)
Logged when a new API key is created for a merchant.

**Fields in details:**
- `keyId`: Unique identifier of the new key
- `keyName`: Friendly name of the key
- `role`: Permission level (user, admin, read-only)
- `expiresAt`: Expiration date if applicable

**Example:**
```json
{
  "eventType": "KeyCreated",
  "timestamp": "2024-02-23T09:15:00Z",
  "user": "merchant_456",
  "outcome": "success",
  "details": {
    "keyId": "key_1708592100",
    "keyName": "Production API Key",
    "role": "user",
    "expiresAt": "2025-02-23"
  }
}
```

### 3. API Key Rotated (`KeyRotated`)
Logged when an API key is rotated (creating a new key and deprecating the old).

**Fields in details:**
- `oldKeyId`: ID of the previous key
- `newKeyId`: ID of the new key
- `reason`: Reason for rotation (scheduled, security, manual)

**Example:**
```json
{
  "eventType": "KeyRotated",
  "timestamp": "2024-02-23T08:00:00Z",
  "user": "merchant_456",
  "outcome": "success",
  "details": {
    "oldKeyId": "key_1708592100",
    "newKeyId": "key_1708678500",
    "reason": "scheduled rotation"
  }
}
```

### 4. API Key Revoked (`KeyRevoked`)
Logged when an API key is revoked/disabled.

**Fields in details:**
- `revokedKeyId`: ID of the revoked key
- `reason`: Reason for revocation (compromised, obsolete, user-initiated)

**Example:**
```json
{
  "eventType": "KeyRevoked",
  "timestamp": "2024-02-22T15:45:00Z",
  "user": "merchant_456",
  "outcome": "success",
  "details": {
    "revokedKeyId": "key_1708592100",
    "reason": "suspected compromise"
  }
}
```

### 5. Gas Transaction (`GasTransaction`)
Logged for every gas-related transaction submitted or processed.

**Fields in details:**
- `transactionHash`: Blockchain transaction hash
- `gasUsed`: Amount of gas consumed
- `gasPrice`: Gas price in the respective denomination
- `senderAddress`: Address that initiated the transaction
- `method`: Contract method called (if applicable)
- `value`: Transaction value (if applicable)

**Example:**
```json
{
  "eventType": "GasTransaction",
  "timestamp": "2024-02-23T11:20:00Z",
  "user": "merchant_123",
  "chainId": 1,
  "outcome": "success",
  "details": {
    "transactionHash": "0x1234567890abcdef",
    "gasUsed": 21000,
    "gasPrice": "45 gwei",
    "senderAddress": "0xabcdefabcdefabcdef",
    "method": "transfer",
    "value": "1.5"
  }
}
```

### 6. Gas Submission (`GasSubmission`)
Logged when gas is submitted for processing (e.g., via subsidy program).

**Fields in details:**
- `submissionId`: Unique submission identifier
- `amount`: Amount of gas submitted
- `subsidyProgram`: Which subsidy program (if applicable)
- `status`: Submission status

### 7. Configuration Update (`ConfigUpdate`)
Logged when system configuration is updated by an administrator.

**Fields in details:**
- `configType`: Type of configuration being updated (e.g., "rate-limits", "alert-thresholds", "rpc-providers")
- `changes`: Object containing the configuration changes made
- `target`: Target of the configuration change (e.g., chain ID, "global", specific component)

**Example:**
```json
{
  "eventType": "ConfigUpdate",
  "timestamp": "2024-02-23T14:30:00Z",
  "user": "admin_user_123",
  "outcome": "success",
  "details": {
    "configType": "alert-thresholds",
    "changes": {
      "gasSpikeThreshold": 150,
      "volatilityThreshold": 25
    },
    "target": "chain-1"
  }
}
```

### 8. Role Change (`RoleChange`)
Logged when user roles are modified by an administrator.

**Fields in details:**
- `targetUser`: User whose role is being changed
- `action`: Type of role change ("grant", "revoke", "update")
- `role`: The role being granted/revoked/updated
- `previousRole`: Previous role (for updates)

**Example:**
```json
{
  "eventType": "RoleChange",
  "timestamp": "2024-02-23T15:45:00Z",
  "user": "admin_user_123",
  "outcome": "success",
  "details": {
    "targetUser": "user_456",
    "action": "grant",
    "role": "admin",
    "previousRole": "operator"
  }
}
```

### 9. Treasury Operation (`TreasuryOperation`)
Logged for treasury-related operations performed by administrators.

**Fields in details:**
- `operation`: Type of treasury operation (e.g., "withdraw", "deposit", "transfer")
- `amount`: Amount involved in the operation
- `asset`: Asset type (e.g., "ETH", "USDC", "gas-tokens")
- `recipient`: Recipient address or identifier
- Additional operation-specific details

**Example:**
```json
{
  "eventType": "TreasuryOperation",
  "timestamp": "2024-02-23T16:20:00Z",
  "user": "admin_user_123",
  "outcome": "success",
  "details": {
    "operation": "withdraw",
    "amount": "1000",
    "asset": "ETH",
    "recipient": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
  }
}
```

### 10. System Administration (`SystemAdmin`)
Logged for general system administration actions.

**Fields in details:**
- `action`: Administrative action performed (e.g., "force-refresh", "system-restart", "maintenance-mode")
- `target`: Target of the administrative action
- Additional action-specific details

**Example:**
```json
{
  "eventType": "SystemAdmin",
  "timestamp": "2024-02-23T17:00:00Z",
  "user": "admin_user_123",
  "outcome": "success",
  "details": {
    "action": "force-refresh",
    "target": "gas-price-data",
    "reason": "Manual data refresh requested"
  }
}
```

## Database Schema

### audit_logs Table

| Field | Type | Description | Indexed |
|-------|------|-------------|---------|
| id | UUID | Primary key, auto-generated | Yes |
| eventType | Enum | Type of event | Yes |
| timestamp | DateTime | When event occurred | Yes |
| user | String(255) | User/merchant ID | Yes |
| apiKey | String(255) | API key used | No |
| chainId | Integer | Blockchain chain ID | Yes |
| details | JSONB | Event-specific data | No |
| outcome | Enum | success/failure/warning | No |
| endpoint | String(255) | API endpoint (for requests) | No |
| httpMethod | String(10) | HTTP method | No |
| responseStatus | Integer | HTTP response code | No |
| ipAddress | String(255) | Client IP address | No |
| errorMessage | Text | Error details if failure | No |
| responseDuration | BigInt | Duration in milliseconds | No |
| integrity | String(64) | SHA256 hash for integrity | No |
| createdAt | DateTime | Record creation time | No |

### api_keys Table

| Field | Type | Description | Indexed |
|-------|------|-------------|---------|
| id | UUID | Primary key | Yes |
| merchantId | String(100) | Associated merchant | Yes |
| name | String(255) | Friendly name | No |
| keyHash | String(255) | SHA256 hash of key | Yes |
| status | Enum | active/rotated/revoked/expired | Yes |
| lastUsedAt | DateTime | Last usage time | No |
| requestCount | Integer | Total requests with key | No |
| expiresAt | DateTime | Expiration date | No |
| description | Text | Key description | No |
| role | String(50) | Permission role | No |
| metadata | JSONB | Additional metadata | No |
| rotatedFromId | UUID | Previous key ID | No |
| createdAt | DateTime | Creation time | Yes |
| updatedAt | DateTime | Last update time | No |

## API Endpoints

### GET /audit/logs
Retrieve audit logs with filtering and pagination.

**Query Parameters:**
- `eventType` (string): Filter by event type (APIRequest, KeyCreated, KeyRotated, KeyRevoked, GasTransaction, GasSubmission, ConfigUpdate, RoleChange, TreasuryOperation, SystemAdmin)
- `user` (string): Filter by user/merchant ID
- `apiKey` (string): Filter by API key
- `chainId` (integer): Filter by blockchain chain ID
- `outcome` (string): Filter by outcome (success, failure, warning)
- `from` (ISO datetime): Start date for range filter
- `to` (ISO datetime): End date for range filter
- `limit` (integer): Results per page, default 50
- `offset` (integer): Pagination offset, default 0
- `sortBy` (string): Sort field, default "timestamp"
- `sortOrder` (string): ASC or DESC, default DESC

**Example Request:**
```bash
GET /audit/logs?eventType=APIRequest&user=merchant_123&from=2024-02-01&to=2024-02-28&limit=50&offset=0
```

**Example Response:**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "eventType": "APIRequest",
      "timestamp": "2024-02-23T10:30:00Z",
      "user": "merchant_123",
      "apiKey": "sk_prod_abc123",
      "outcome": "success",
      "endpoint": "/scanner/scan",
      "httpMethod": "POST",
      "responseStatus": 200,
      "ipAddress": "192.168.1.100",
      "responseDuration": 250,
      "createdAt": "2024-02-23T10:30:00Z"
    }
  ],
  "total": 1543,
  "limit": 50,
  "offset": 0
}
```

### GET /audit/logs/:id
Retrieve a specific audit log by ID.

**Example Request:**
```bash
GET /audit/logs/550e8400-e29b-41d4-a716-446655440000
```

**Example Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "APIRequest",
  "timestamp": "2024-02-23T10:30:00Z",
  "user": "merchant_123",
  "apiKey": "sk_prod_abc123",
  "details": {},
  "outcome": "success",
  "endpoint": "/scanner/scan",
  "httpMethod": "POST",
  "responseStatus": 200,
  "ipAddress": "192.168.1.100",
  "responseDuration": 250,
  "createdAt": "2024-02-23T10:30:00Z"
}
```

### GET /audit/logs/type/:eventType
Retrieve logs filtered by event type.

**Example Request:**
```bash
GET /audit/logs/type/KeyCreated?limit=100
```

**Example Response:**
```json
[
  {
    "id": "...",
    "eventType": "KeyCreated",
    "timestamp": "2024-02-23T09:15:00Z",
    "user": "merchant_456",
    "outcome": "success",
    "details": {
      "keyId": "key_1708592100",
      "keyName": "Production API Key",
      "role": "user"
    },
    "createdAt": "2024-02-23T09:15:00Z"
  }
]
```

### GET /audit/logs/user/:userId
Retrieve logs for a specific user/merchant.

**Example Request:**
```bash
GET /audit/logs/user/merchant_123?limit=100
```

### POST /audit/logs/export
Export audit logs in CSV or JSON format.

**Request Body:**
```json
{
  "format": "csv",
  "eventType": "APIRequest",
  "user": "merchant_123",
  "from": "2024-02-01T00:00:00Z",
  "to": "2024-02-28T23:59:59Z"
}
```

**Response:** File download with appropriate Content-Type header

**Formats:**
- CSV: `Content-Type: text/csv`
- JSON: `Content-Type: application/json`

### GET /audit/stats
Retrieve high-level audit statistics.

**Example Response:**
```json
{
  "message": "Audit statistics endpoint",
  "totalEvents": 15432,
  "eventsByType": {
    "APIRequest": 12000,
    "KeyCreated": 150,
    "GasTransaction": 3000,
    "KeyRotated": 200,
    "KeyRevoked": 50,
    "GasSubmission": 32,
    "ConfigUpdate": 45,
    "RoleChange": 12,
    "TreasuryOperation": 8,
    "SystemAdmin": 23
  }
}
```

## Access Control

All audit endpoints require authentication and authorization:

- **Local Development**: Endpoints are accessible without guards (configure in production)
- **Production**: Add `@UseGuards(AdminGuard)` to restrict access to admin users only
- **Implementation**: Use `AdminGuard` or similar auth middleware

Example implementation for production:
```typescript
@Controller('audit')
@UseGuards(AdminGuard)
export class AuditController {
  // Protected endpoints
}
```

## Emitting Events Programmatically

### From Services

```typescript
import { AuditLogService } from './audit/services';

export class YourService {
  constructor(private auditLogService: AuditLogService) {}

  async someAction() {
    // Emit API request (automatically done by interceptor)
    this.auditLogService.emitApiRequest(
      'api_key_abc',
      '/endpoint',
      'POST',
      200,
      '192.168.1.1',
      150,
    );

    // Emit API key creation event
    this.auditLogService.emitApiKeyEvent(
      EventType.API_KEY_CREATED,
      'merchant_123',
      { keyId: 'key_1', name: 'Production Key', role: 'user' }
    );

    // Emit gas transaction event
    this.auditLogService.emitGasTransaction(
      'merchant_123',
      1, // chainId
      '0x1234567890abcdef', // txHash
      21000, // gasUsed
      '45 gwei', // gasPrice
      '0xabcdefabcdefabcdef', // senderAddress
      { method: 'transfer', value: '1.5' } // additional details
    );
  }
}
```

## Log Integrity & Security

### Cryptographic Integrity

Each log entry includes an `integrity` field containing a SHA256 hash of the event data to prevent unauthorized modifications.

```typescript
integrity = SHA256(JSON.stringify(auditLogDto))
```

### Append-Only Design

- Logs are never updated or deleted by normal operations
- Only retention policies can remove old logs
- Schema uses immutable storage patterns
- Timestamp fields are set at creation time

### Access Control Best Practices

1. Restrict audit log access to admin users only
2. Log all access to audit logs themselves
3. Use HTTPS/TLS for all API communication
4. Implement rate limiting on audit endpoints
5. Store API key hashes, never plaintext

## Retention Policies

### Default Retention

Configure retention via environment variables or code:

```typescript
// Cleanup logs older than 90 days
await auditLogService.retentionCleanup(90);
```

### Recommended Policies

- **API Requests**: 30-90 days
- **Key Lifecycle Events**: 1-2 years
- **Gas Transactions**: 6-12 months (for compliance)
- **Failed Events**: 1-2 years (for troubleshooting)

### Automatic Cleanup

Set up scheduled jobs:

```typescript
@Cron('0 0 * * *') // Daily at midnight
async cleanupOldLogs() {
  const retentionDays = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90');
  await this.auditLogService.retentionCleanup(retentionDays);
}
```

## Query Optimization

### Strategic Indexes

The schema includes composite and single-column indexes:

```sql
-- Fast queries by event type and user
idx_audit_composite ON (eventType, user, timestamp)

-- Fast range queries
idx_audit_timestamp ON (timestamp)

-- Identity queries
idx_audit_event_type ON (eventType)
idx_audit_user ON (user)
idx_audit_chain_id ON (chainId)
```

### Query Examples

```typescript
// Fast - uses composite index
auditLogService.queryLogs({
  eventType: EventType.API_REQUEST,
  user: 'merchant_123',
  from: '2024-02-01',
  to: '2024-02-28'
});

// Fast - uses timestamp index for range
auditLogService.queryLogs({
  from: '2024-02-01',
  to: '2024-02-28'
});

// Medium - filters by single column
auditLogService.getLogsByUser('merchant_123');
```

## Compliance & Reporting

### Common Reports

**1. User Activity Report**
```typescript
const logs = await auditLogService.queryLogs({
  user: 'merchant_123',
  from: '2024-01-01',
  to: '2024-01-31',
  limit: 10000
});

// Export as CSV
const csv = await auditLogService.exportLogs('csv', { user: 'merchant_123' });
```

**2. API Key Lifecycle Report**
```typescript
const keyEvents = await auditLogService.queryLogs({
  eventType: EventType.API_KEY_CREATED,
  from: '2024-01-01',
  to: '2024-12-31',
  limit: 10000
});
```

**3. Gas Transaction Report**
```typescript
const gasLogs = await auditLogService.queryLogs({
  eventType: EventType.GAS_TRANSACTION,
  chainId: 1,
  from: '2024-02-01',
  to: '2024-02-28',
  limit: 10000
});
```

**4. Failed Requests Report**
```typescript
const failures = await auditLogService.queryLogs({
  eventType: EventType.API_REQUEST,
  outcome: OutcomeStatus.FAILURE,
  from: '2024-02-01',
  to: '2024-02-28',
  limit: 10000
});
```

## Testing

Run audit system tests:

```bash
# Unit tests
npm test -- audit-log.service.spec.ts
npm test -- audit-event-emitter.spec.ts

# Integration/E2E tests
npm run test:e2e -- audit.controller.e2e.spec.ts

# Coverage report
npm run test:cov -- src/audit
```

## Migration & Setup

### Database Migration

Run migrations to create audit tables:

```bash
npm run migration:run
```

### Initial Setup

1. Ensure PostgreSQL is running
2. Run database migrations
3. Restart API service
4. Verify with `GET /audit/logs` (should return empty data array)

## Troubleshooting

### Logs Not Being Captured

1. Check if `AuditModule` is imported in `AppModule`
2. Verify `AuditInterceptor` is registered in `main.ts`
3. Check database connection in logs
4. Ensure PostgreSQL is running and accessible

### Performance Issues

1. Monitor database query times
2. Verify indexes are created:
   ```sql
   SELECT * FROM pg_indexes WHERE tablename = 'audit_logs';
   ```
3. Consider archiving old logs to separate table
4. Implement pagination with appropriate limits

### Export Failures

1. Verify CSV parsing library is installed
2. Check file permissions
3. Monitor disk space
4. Reduce export size if failing

## Future Enhancements

- [ ] Elasticsearch integration for large-scale queries
- [ ] Real-time log streaming via WebSockets
- [ ] Advanced analytics dashboard
- [ ] Automated compliance report generation
- [ ] Log encryption at rest
- [ ] Distributed tracing integration
- [ ] Machine learning for anomaly detection
- [ ] Audit log digitally signed exports

## References

- [NestJS Documentation](https://docs.nestjs.com)
- [TypeORM Documentation](https://typeorm.io)
- [PostgreSQL JSONB Guide](https://www.postgresql.org/docs/current/datatype-json.html)
