# Configurable Fee Configuration System

## Overview

The GasGuard configurable fee system allows administrators to dynamically update protocol fees, tier multipliers, and pricing policies without requiring code deployments. This system provides comprehensive audit trails, validation, and user notification capabilities.

## Architecture

### Core Components

1. **FeeConfigurationService** - Core business logic for fee management
2. **FeeConfigurationController** - REST API endpoints for admin operations
3. **Event System** - Emits events for fee changes and notifications
4. **Validation Engine** - Validates fee updates before application
5. **Audit Trail** - Maintains complete history of all fee changes

### Data Flow

```
Admin Request → Validation → Configuration Update → Event Emission → User Notification
     ↓                ↓               ↓                ↓
   Audit Log ← History Store ← Event Store ← Notification Queue
```

## Fee Structure

### Base Configuration

```typescript
interface FeeConfiguration {
  id: string;
  name: string;
  description: string;
  basePricePerRequest: number; // in XLM
  currency: string;
  tierMultipliers: {
    starter: number;
    developer: number;
    professional: number;
    enterprise: number;
  };
  discountPercentages: {
    starter: number;
    developer: number;
    professional: number;
    enterprise: number;
  };
  // ... additional settings
}
```

### Tier Pricing Model

| Tier | Base Multiplier | Discount | Effective Price |
|------|----------------|----------|----------------|
| Starter | 1.0x | 0% | basePrice × 1.0 |
| Developer | 0.8x | 20% | basePrice × 0.8 |
| Professional | 0.6x | 40% | basePrice × 0.6 |
| Enterprise | 0.4x | 60% | basePrice × 0.4 |

## API Endpoints

### Configuration Management

#### Get Current Configuration
```http
GET /admin/fee-configuration/current
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "default",
    "name": "Default GasGuard Pricing",
    "basePricePerRequest": 0.00001,
    "tierMultipliers": {
      "starter": 1.0,
      "developer": 0.8,
      "professional": 0.6,
      "enterprise": 0.4
    },
    "discountPercentages": {
      "starter": 0,
      "developer": 20,
      "professional": 40,
      "enterprise": 60
    }
  }
}
```

#### Update Configuration
```http
PUT /admin/fee-configuration/{configId}
```

**Request Body:**
```json
{
  "basePricePerRequest": 0.000015,
  "tierMultipliers": {
    "professional": 0.55
  },
  "discountPercentages": {
    "enterprise": 65
  },
  "reason": "Market adjustment and improved enterprise pricing",
  "effectiveDate": "2024-02-01T00:00:00Z",
  "notifyUsers": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "default",
    "basePricePerRequest": 0.000015,
    "version": 2,
    "updatedAt": "2024-01-15T10:30:00Z"
  },
  "message": "Fee configuration updated successfully",
  "warnings": ["Base price increase may affect user adoption"],
  "impact": {
    "affectedUsers": 30000,
    "priceIncreasePercentage": 50
  }
}
```

#### Validate Changes (Preview)
```http
POST /admin/fee-configuration/{configId}/validate
```

**Response:**
```json
{
  "success": false,
  "data": {
    "isValid": false,
    "errors": ["Base price per request cannot be negative"],
    "warnings": ["Large price increase detected"],
    "impact": {
      "affectedUsers": 30000,
      "priceIncreasePercentage": 100
    }
  }
}
```

#### Preview Changes
```http
POST /admin/fee-configuration/{configId}/preview
```

**Response:**
```json
{
  "success": true,
  "data": {
    "currentConfiguration": { /* current config */ },
    "previewConfiguration": { /* proposed config */ },
    "validation": { /* validation results */ },
    "changes": [
      {
        "field": "basePricePerRequest",
        "oldValue": 0.00001,
        "newValue": 0.000015
      }
    ]
  }
}
```

### History and Analytics

#### Configuration History
```http
GET /admin/fee-configuration/{configId}/history
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "hist_123",
      "configurationId": "default",
      "version": 3,
      "configuration": { /* full config at this version */ },
      "changeEvent": {
        "type": "FEE_UPDATED",
        "timestamp": "2024-01-15T10:30:00Z",
        "metadata": {
          "updatedBy": "admin-user",
          "reason": "Market adjustment"
        }
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "createdBy": "admin-user"
    }
  ]
}
```

#### Fee Change Events
```http
GET /admin/fee-configuration/{configId}/events?startDate=2024-01-01&endDate=2024-01-31
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "event_456",
      "configurationId": "default",
      "type": "FEE_UPDATED",
      "timestamp": "2024-01-15T10:30:00Z",
      "changes": [
        {
          "field": "basePricePerRequest",
          "oldValue": 0.00001,
          "newValue": 0.000015
        }
      ],
      "metadata": {
        "updatedBy": "admin-user",
        "reason": "Market adjustment",
        "effectiveDate": "2024-01-15T10:30:00Z",
        "notifyUsers": true,
        "version": 2
      }
    }
  ]
}
```

#### Fee Analytics
```http
GET /admin/fee-configuration/analytics?startDate=2024-01-01&endDate=2024-01-31
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalRevenue": {
      "daily": 1200.50,
      "weekly": 8403.50,
      "monthly": 36015.00,
      "yearly": 432180.00
    },
    "usageByTier": {
      "starter": 1000,
      "developer": 5000,
      "professional": 15000,
      "enterprise": 9000
    },
    "revenueByTier": {
      "starter": 10.00,
      "developer": 40.00,
      "professional": 540.00,
      "enterprise": 2160.00
    },
    "trends": {
      "revenueGrowth": 15.5,
      "usageGrowth": 8.2,
      "averageRevenuePerUser": 1.20
    },
    "period": {
      "startDate": "2024-01-01T00:00:00Z",
      "endDate": "2024-01-31T23:59:59Z"
    }
  }
}
```

### Admin Settings

#### Get Admin Settings
```http
GET /admin/fee-configuration/settings
```

#### Update Admin Settings
```http
PUT /admin/fee-configuration/settings
```

**Request Body:**
```json
{
  "allowFeeUpdates": true,
  "requireApprovalForLargeChanges": true,
  "largeChangeThreshold": 25,
  "approvalRequiredUsers": ["admin-1", "admin-2"],
  "multisigSigners": ["admin-1", "admin-2", "admin-3"],
  "multisigApprovalThreshold": 2,
  "timelockDelayMinutes": 60,
  "defaultGracePeriod": 7,
  "enableUserNotifications": true,
  "notificationChannels": ["email", "in-app"],
  "maxFeeChangesPerDay": 10,
  "maxFeeChangesPerHour": 2
}
```

## Event System

### Event Types

1. **FEE_CREATED** - New fee configuration created
2. **FEE_UPDATED** - Existing configuration updated
3. **FEE_DELETED** - Configuration removed
4. **FEE_RESTORED** - Configuration restored from history
5. **USER_NOTIFICATION** - User notification sent

### Event Structure

```typescript
interface FeeChangeEvent {
  id: string;
  configurationId: string;
  type: 'FEE_UPDATED' | 'FEE_CREATED' | 'FEE_DELETED' | 'FEE_RESTORED';
  timestamp: Date;
  oldConfiguration?: Partial<FeeConfiguration>;
  newConfiguration: Partial<FeeConfiguration>;
  changes: FeeChange[];
  metadata: {
    updatedBy: string;
    reason: string;
    effectiveDate: Date;
    notifyUsers: boolean;
    version: number;
  };
}
```

### Event Handlers

```typescript
// Listen to fee changes
feeConfigurationService.on('feeChanged', (event: FeeChangeEvent) => {
  console.log(`Fee configuration changed: ${event.metadata.reason}`);
  
  // Handle different event types
  switch (event.type) {
    case 'FEE_UPDATED':
      // Handle fee update
      break;
    case 'FEE_CREATED':
      // Handle new configuration
      break;
    case 'FEE_DELETED':
      // Handle deletion
      break;
  }
});

// Listen to user notifications
feeConfigurationService.on('userNotification', (notification) => {
  // Send user notifications via configured channels
  sendUserNotification(notification);
});
```

## Validation Rules

### Base Price Validation
- Must be ≥ 0 (non-negative)
- Should be ≤ 1 XLM (warning if higher)
- Cannot exceed maximum fee if set

### Tier Multiplier Validation
- Must be ≥ 0 (non-negative)
- Should be ≤ 10 (warning if higher)
- Must be reasonable for business model

### Discount Percentage Validation
- Must be between 0 and 100 (inclusive)
- Enterprise tier typically has highest discount
- Starter tier typically has 0% discount

### Rate Limit Validation
- Must be positive integers
- Enterprise tier should have highest limits
- Should align with infrastructure capacity

### Request Limit Validation
- Positive integers or -1 (unlimited)
- Enterprise tier typically -1
- Should reflect service capacity

## Admin Controls

### Approval Workflow

For large changes (configurable threshold):

1. **Define signers** - Configure `multisigSigners` and `multisigApprovalThreshold`
2. **Detection** - System detects change > threshold
3. **Request** - A multisig approval request is created
4. **Approval** - Designated signers approve the request
5. **Timelock** - Approved changes wait until `timelockDelayMinutes` has elapsed
6. **Implementation** - Change is applied after the scheduled delay
7. **Audit** - Full audit trail is maintained

### Approval endpoints

- `POST /admin/fee-configuration/:configId/approval-requests`
- `GET /admin/fee-configuration/approval-requests`
- `GET /admin/fee-configuration/approval-requests/:requestId`
- `POST /admin/fee-configuration/approval-requests/:requestId/approve`
- `POST /admin/fee-configuration/approval-requests/:requestId/reject`

### Scheduled update endpoints

- `GET /admin/fee-configuration/scheduled-updates`
- `GET /admin/fee-configuration/scheduled-updates/:updateId`
- `POST /admin/fee-configuration/scheduled-updates/process`

### Scheduled updates

Scheduled updates are created when the configured `timelockDelayMinutes` is greater than zero. Approved fee changes are queued and only applied once the delay has elapsed.

### Rate Limiting

Admin operations are rate-limited to prevent abuse:

- **Per Hour**: Configurable (default: 2 changes)
- **Per Day**: Configurable (default: 10 changes)
- **Grace Period**: Configurable (default: 7 days)

### User Notifications

Configurable notification channels:

- **Email** - Standard email notifications
- **SMS** - Text message alerts
- **In-App** - Application notifications
- **Webhook** - Custom webhook endpoints

## Security Considerations

### Authentication
- All admin endpoints require authentication
- Role-based access control
- API key authentication for service-to-service

### Authorization
- Only authorized admins can modify fees
- Different permission levels for different operations
- Audit log of all access attempts

### Data Validation
- Server-side validation of all inputs
- SQL injection prevention
- XSS protection for web interfaces

### Audit Trail
- Immutable log of all changes
- Tamper-evident storage
- Retention policy compliance

## Integration Examples

### Node.js SDK

```javascript
const { GasGuardAdmin } = require('@gasguard/admin-sdk');

const admin = new GasGuardAdmin({
  apiKey: 'admin-api-key',
  baseUrl: 'https://api.gasguard.dev'
});

// Update fee configuration
const result = await admin.updateFeeConfiguration('default', {
  basePricePerRequest: 0.000015,
  tierMultipliers: {
    professional: 0.55
  },
  reason: 'Market adjustment',
  notifyUsers: true
});

console.log('Fee updated:', result.data);
```

### Python SDK

```python
from gasguard_admin import GasGuardAdmin

admin = GasGuardAdmin(
    api_key='admin-api-key',
    base_url='https://api.gasguard.dev'
)

# Update fee configuration
result = admin.update_fee_configuration('default', {
    'base_price_per_request': 0.000015,
    'tier_multipliers': {
        'professional': 0.55
    },
    'reason': 'Market adjustment',
    'notify_users': True
})

print('Fee updated:', result['data'])
```

### cURL Examples

```bash
# Get current configuration
curl -X GET "https://api.gasguard.dev/admin/fee-configuration/current" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Update configuration
curl -X PUT "https://api.gasguard.dev/admin/fee-configuration/default" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "basePricePerRequest": 0.000015,
    "tierMultipliers": {
      "professional": 0.55
    },
    "reason": "Market adjustment",
    "notifyUsers": true
  }'

# Validate changes
curl -X POST "https://api.gasguard.dev/admin/fee-configuration/default/validate" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "basePricePerRequest": 0.000015,
    "reason": "Test validation"
  }'
```

## Monitoring and Alerting

### Health Checks

Monitor fee configuration service health:

```bash
# Service health
curl https://api.gasguard.dev/health/fee-configuration

# Database connectivity
curl https://api.gasguard.dev/health/database

# Event system status
curl https://api.gasguard.dev/health/events
```

### Metrics to Monitor

- **Configuration Updates**: Number of fee changes per day/week/month
- **Validation Failures**: Failed validation attempts
- **User Notifications**: Delivery success/failure rates
- **API Performance**: Response times and error rates
- **Database Performance**: Query performance and connection health

### Alerting Rules

- **High Rate of Changes**: > 5 changes per hour
- **Validation Failures**: > 10% failure rate
- **Notification Failures**: > 5% failure rate
- **Service Downtime**: Any service unavailability

## Best Practices

### Fee Updates

1. **Preview Changes**: Always validate before applying
2. **Schedule Maintenance**: Use grace periods for large changes
3. **Communicate Clearly**: Provide detailed reasons for changes
4. **Monitor Impact**: Track user reaction and system performance
5. **Backup Configuration**: Maintain rollback capability

### User Communication

1. **Advance Notice**: Notify users before changes take effect
2. **Clear Explanation**: Explain why changes are necessary
3. **Impact Analysis**: Show how changes affect different tiers
4. **Support Channels**: Provide help during transition periods
5. **Feedback Collection**: Gather user feedback on changes

### Security

1. **Principle of Least Privilege**: Minimum necessary permissions
2. **Regular Audits**: Review admin access logs
3. **Secure Credentials**: Rotate API keys regularly
4. **Network Security**: Use HTTPS, validate certificates
5. **Data Encryption**: Encrypt sensitive configuration data

## Troubleshooting

### Common Issues

#### Configuration Not Updating
- **Check Authentication**: Verify admin token is valid
- **Validation Errors**: Review request body for validation issues
- **Rate Limits**: Check if you've exceeded rate limits
- **Permissions**: Verify user has required permissions

#### User Notifications Not Sending
- **Channel Configuration**: Check notification channel settings
- **Template Issues**: Verify notification templates
- **Delivery Service**: Check email/SMS provider status
- **User Preferences**: Verify user notification preferences

#### Analytics Data Inaccurate
- **Data Sync**: Check if analytics data is current
- **Time Zone**: Verify date range calculations
- **Event Processing**: Check if all events are processed
- **Calculation Logic**: Review revenue calculation formulas

### Debug Mode

Enable debug logging for detailed troubleshooting:

```javascript
const admin = new GasGuardAdmin({
  apiKey: 'admin-api-key',
  debug: true,
  logLevel: 'verbose'
});
```

## Migration Guide

### From Static Configuration

1. **Export Current Config**: Extract existing fee settings
2. **Map to New Structure**: Convert to fee configuration format
3. **Import via API**: Use configuration creation endpoint
4. **Validate Import**: Verify all settings migrated correctly
5. **Test Functionality**: Ensure all features work as expected

### Version Management

- **Semantic Versioning**: Use version numbers for tracking
- **Rollback Capability**: Maintain ability to revert changes
- **Change Logs**: Document all modifications with reasons
- **Backup Strategy**: Regular configuration backups

## Future Enhancements

### Planned Features

1. **Multi-Currency Support**: Fees in different currencies
2. **Dynamic Pricing**: AI-powered dynamic fee adjustment
3. **A/B Testing**: Test different pricing strategies
4. **Advanced Analytics**: Machine learning insights
5. **Automated Optimization**: Self-adjusting fee structures

### Extensibility

- **Plugin System**: Allow custom fee calculation plugins
- **Webhook Support**: Real-time fee change notifications
- **API Versioning**: Maintain backward compatibility
- **Custom Validation**: Domain-specific validation rules

---

## Support

- **Documentation**: [docs.gasguard.dev/fee-configuration](https://docs.gasguard.dev/fee-configuration)
- **API Reference**: [api.gasguard.dev/admin](https://api.gasguard.dev/admin)
- **Support Tickets**: [support.gasguard.dev](https://support.gasguard.dev)
- **Status Page**: [status.gasguard.dev](https://status.gasguard.dev)
- **Community**: [GitHub Discussions](https://github.com/gasguard/discussions)
