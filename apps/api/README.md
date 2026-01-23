# GasGuard Analysis API

Professional API contracts for submitting codebases for security and performance analysis, with specialized support for Soroban projects.

## Features

- **Comprehensive API Contracts**: Well-defined request/response schemas for all analysis operations
- **Soroban Project Support**: Specialized validation and analysis for Stellar Soroban contracts
- **Robust Validation**: Input validation with detailed error messages
- **Error Handling**: Structured error responses with proper HTTP status codes
- **Queue-based Processing**: Asynchronous analysis with job tracking
- **Backward Compatibility**: Legacy scan endpoints maintained

## API Endpoints

### Submit Codebase for Analysis
```
POST /analysis
```

Submit a codebase for comprehensive analysis including security, performance, and gas optimization.

**Request Body:**
```json
{
  "project": {
    "name": "my-soroban-contract",
    "description": "A Stellar Soroban smart contract",
    "repositoryUrl": "https://github.com/user/repo.git",
    "commitHash": "abc123"
  },
  "files": [
    {
      "path": "src/lib.rs",
      "content": "pub mod contract;",
      "language": "rust",
      "size": 18,
      "lastModified": "2024-01-15T10:30:00Z"
    }
  ],
  "options": {
    "scanType": "full",
    "severity": "medium",
    "includeRecommendations": true
  },
  "metadata": {
    "framework": "soroban",
    "version": "0.1.0",
    "dependencies": {
      "soroban-sdk": "20.0.0"
    },
    "buildSystem": "cargo",
    "network": "stellar"
  }
}
```

**Response:**
```json
{
  "jobId": "job_123456789",
  "status": "queued",
  "submittedAt": "2024-01-15T10:30:00Z",
  "estimatedDuration": 120,
  "statusUrl": "/analysis/job_123456789/status",
  "resultUrl": "/analysis/job_123456789/result"
}
```

### Get Analysis Status
```
GET /analysis/{jobId}/status
```

Check the current status of an analysis job.

**Response:**
```json
{
  "jobId": "job_123456789",
  "status": "processing",
  "progress": 45,
  "currentStep": "Analyzing contract functions",
  "startedAt": "2024-01-15T10:30:05Z"
}
```

### Get Analysis Results
```
GET /analysis/{jobId}/result
```

Retrieve the complete analysis results for a completed job.

**Response:**
```json
{
  "result": {
    "jobId": "job_123456789",
    "status": "completed",
    "completedAt": "2024-01-15T10:32:15Z",
    "duration": 130,
    "summary": {
      "totalFiles": 5,
      "totalIssues": 12,
      "issuesBySeverity": {
        "high": 2,
        "medium": 7,
        "low": 3
      },
      "gasSavings": {
        "totalGasSaved": 15000,
        "percentageSaved": 15.5
      }
    },
    "files": [...],
    "recommendations": [...]
  }
}
```

### Cancel Analysis
```
DELETE /analysis/{jobId}
```

Cancel a running or queued analysis job.

**Response:**
```json
{
  "message": "Analysis cancelled successfully",
  "jobId": "job_123456789",
  "cancelledAt": "2024-01-15T10:31:00Z"
}
```

## Soroban Project Validation

The API includes specialized validation for Soroban projects:

- **Required Files**: At least one Rust file and Cargo.toml
- **Dependency Check**: Must include soroban-sdk or stellar-sdk
- **Contract Detection**: Files must contain contract implementations
- **Structure Validation**: Proper Soroban contract structure

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "timestamp": "2024-01-15T10:30:00Z",
    "requestId": "req_123456789"
  },
  "validationErrors": [
    {
      "field": "project.name",
      "message": "Project name is required",
      "constraint": "required"
    }
  ]
}
```

## Rate Limits

- **Maximum file size**: 10MB per file
- **Maximum total size**: 50MB per submission
- **Maximum files**: 100 files per submission
- **Content length limit**: 50MB total JSON payload

## Legacy Endpoints

For backward compatibility, the following legacy endpoints are maintained:

- `POST /scan` - Submit for scanning (limited functionality)
- `GET /scan/{id}/status` - Get scan status
- `GET /scan/{id}/result` - Get scan results

## Health Check

```
GET /health
```

Check API health and status:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "requestId": "req_123456789"
}
```

## API Documentation

```
GET /docs
```

Get API documentation and available endpoints.

## Implementation Details

### File Structure

```
src/
├── schemas/
│   └── analysis.schema.ts     # TypeScript interfaces and types
├── validation/
│   └── analysis.validator.ts  # Request validation middleware
├── controllers/
│   └── analysis.controller.ts # API endpoint handlers
├── routes/
│   └── analysis.routes.ts     # Route definitions
├── middleware/
│   └── error.middleware.ts    # Error handling middleware
└── server.ts                  # Main server configuration
```

### Key Features

1. **Type Safety**: Full TypeScript support with comprehensive interfaces
2. **Validation**: Input validation with detailed error messages
3. **Error Handling**: Structured error responses
4. **Queue Integration**: BullMQ for job processing
5. **CORS Support**: Cross-origin request handling
6. **Request Tracking**: Unique request IDs for debugging

### Dependencies

- `express`: Web framework
- `bullmq`: Job queue management
- `ioredis`: Redis client for BullMQ

## Usage Example

```typescript
import axios from 'axios';

const submitAnalysis = async () => {
  const payload = {
    project: {
      name: 'my-contract',
      description: 'Soroban smart contract'
    },
    files: [
      {
        path: 'src/lib.rs',
        content: contractSource,
        language: 'rust',
        size: contractSource.length
      }
    ],
    metadata: {
      framework: 'soroban',
      buildSystem: 'cargo'
    }
  };

  try {
    const response = await axios.post('/analysis', payload);
    const { jobId, statusUrl } = response.data;
    
    // Poll for results
    const result = await pollForResult(statusUrl);
    console.log('Analysis complete:', result);
  } catch (error) {
    console.error('Analysis failed:', error.response.data);
  }
};
```

## Development

To run the API in development:

```bash
npm run dev
```

To build for production:

```bash
npm run build
npm start
```

## Testing

The API includes comprehensive validation and error handling. Test with various scenarios:

1. Valid Soroban project submission
2. Missing required fields
3. Invalid file formats
4. Oversized payloads
5. Missing Soroban dependencies

## Security Considerations

- Input validation prevents malicious payloads
- File size limits prevent resource exhaustion
- Request tracking enables audit logging
- Error messages don't expose sensitive information
