# GasGuard API

Nest.js backend handling remote scan requests with timeout protection.

## Features

- **Timeout Protection**: Prevents runaway scans from degrading system performance
- **Configurable Timeouts**: Set max execution time via environment variables
- **Worker Thread Support**: Optional worker-based scanning for additional isolation
- **Clear Error Messages**: Graceful failure with descriptive timeout errors

## Configuration

Set the maximum execution time for scans via environment variable:

```bash
SCAN_MAX_EXECUTION_TIME_MS=30000  # 30 seconds (default)
```

## Usage

### Basic Scan Endpoint

```bash
POST /scan
Content-Type: application/json

{
  "contractCode": "contract code here...",
  "timeoutMs": 30000  # optional, overrides default
}
```

### Response

**Success:**
```json
{
  "scanId": "scan_1234567890_abc123",
  "status": "completed",
  "findings": [],
  "executionTime": 1234567890
}
```

**Timeout Error:**
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

## Implementation Details

### Promise.race Approach (Default)

The `ScanService` uses `Promise.race()` to enforce timeouts:

```typescript
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(timeoutError), timeoutMs);
});
const result = await Promise.race([scanPromise, timeoutPromise]);
```

### Worker Thread Approach (Optional)

For additional isolation, use `WorkerScanService` which runs scans in worker threads:

- Prevents blocking the main event loop
- Automatic cleanup on timeout via `worker.terminate()`
- Better resource isolation

## Error Handling

All timeout errors include:
- `code`: "SCAN_TIMEOUT"
- `message`: Descriptive error message
- `scanId`: Unique identifier for tracking
- `timeoutMs`: The timeout value that was exceeded
