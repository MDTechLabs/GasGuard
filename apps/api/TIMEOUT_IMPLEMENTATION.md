# Timeout Implementation Guide

## Overview

This implementation prevents runaway scans from degrading system performance by enforcing maximum execution time limits per scan operation.

## Implementation Approaches

### 1. Promise.race Approach (Primary - ScanService)

**Location:** `src/scan/scan.service.ts`

**How it works:**
- Uses `Promise.race()` to compete a scan promise against a timeout promise
- If the timeout promise resolves first, the scan is terminated with a clear error
- Lightweight and doesn't require additional processes

**Usage:**
```typescript
const result = await scanService.executeScan(contractCode, {
  timeoutMs: 30000 // optional, defaults to config value
});
```

**Error Handling:**
```typescript
try {
  const result = await scanService.executeScan(contractCode);
} catch (error) {
  if (error.code === 'SCAN_TIMEOUT') {
    console.error(`Scan timed out after ${error.timeoutMs}ms`);
  }
}
```

### 2. Worker Thread Approach (Optional - WorkerScanService)

**Location:** `src/scan/worker-scan.service.ts`

**How it works:**
- Runs scans in isolated worker threads
- Automatically terminates workers that exceed timeout
- Provides better isolation and prevents blocking the main event loop
- More resource-intensive but safer for long-running operations

**Usage:**
```typescript
// Add WorkerScanService to ScanModule providers
const result = await workerScanService.executeScanInWorker(contractCode, {
  timeoutMs: 30000
});
```

**Benefits:**
- Complete isolation from main process
- Automatic cleanup via `worker.terminate()`
- Prevents event loop blocking

## Configuration

### Environment Variables

Set the default maximum execution time:

```bash
# .env or .env.local
SCAN_MAX_EXECUTION_TIME_MS=30000  # 30 seconds (default)
```

### Per-Scan Override

You can override the timeout for individual scans:

```typescript
// Use custom timeout for this specific scan
await scanService.executeScan(contractCode, {
  timeoutMs: 60000 // 60 seconds
});
```

## Error Response Format

### Timeout Error Structure

```typescript
{
  code: 'SCAN_TIMEOUT',
  message: 'Scan exceeded maximum execution time of 30000ms',
  scanId: 'scan_1234567890_abc123',
  timeoutMs: 30000
}
```

### HTTP Response (408 Request Timeout)

```json
{
  "statusCode": 408,
  "message": "Scan exceeded maximum execution time. Scan exceeded maximum execution time of 30000ms",
  "error": {
    "code": "SCAN_TIMEOUT",
    "message": "Scan exceeded maximum execution time of 30000ms",
    "scanId": "scan_1234567890_abc123",
    "timeoutMs": 30000
  }
}
```

## Integration Points

### Current Implementation

1. **ScanService** (`src/scan/scan.service.ts`)
   - Primary service using Promise.race
   - Used by ScanController

2. **WorkerScanService** (`src/scan/worker-scan.service.ts`)
   - Optional worker-based implementation
   - Can be added to ScanModule if needed

3. **ScanController** (`src/scan/scan.controller.ts`)
   - HTTP endpoint: `POST /scan`
   - Handles timeout errors with 408 status code
   - Validates input before starting scan

## Testing Timeout Behavior

### Unit Test Example

See `src/scan/scan.service.spec.ts` for examples of:
- Testing successful scans
- Testing timeout scenarios
- Testing custom timeout values

### Manual Testing

To test timeout behavior, you can simulate a long-running scan:

```typescript
// In performScan method, add a delay longer than timeout
await new Promise(resolve => setTimeout(resolve, 40000)); // 40 seconds
// Then call with 30 second timeout - should fail
```

## Best Practices

1. **Set Reasonable Defaults**: 30 seconds is a good default, but adjust based on:
   - Average contract complexity
   - System resources
   - User expectations

2. **Log Timeouts**: All timeouts are logged with scan ID for debugging

3. **Monitor Timeout Frequency**: If many scans timeout, consider:
   - Increasing default timeout
   - Optimizing scan algorithms
   - Using worker threads for better isolation

4. **Graceful Degradation**: Timeout errors are clearly communicated to users

## Done Criteria ✅

- ✅ Scans exceeding limit fail gracefully with clear error
- ✅ Uses Node.js process timeout (Promise.race)
- ✅ Provides worker constraints option (WorkerScanService)
- ✅ Configurable via environment variables
- ✅ Per-scan timeout override supported
- ✅ Comprehensive error handling and logging
