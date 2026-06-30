# Soroban Analysis Artifact Storage

Storage system for persisting and retrieving generated analysis artifacts in GasGuard.

## Overview

The Soroban Analysis Artifact Storage system provides comprehensive functionality for:

- **Storing analysis artifacts** - Save reports, snapshots, and analysis results with metadata
- **Metadata management** - Track artifact properties, tags, and relationships
- **Efficient retrieval** - Query and retrieve artifacts with flexible search capabilities
- **Caching** - Configurable in-memory caching for frequently accessed artifacts
- **Integrity verification** - Checksum validation for data consistency
- **Batch operations** - Handle multiple artifacts efficiently
- **Statistics tracking** - Monitor storage usage and artifact distribution

## Components

### 1. ArtifactStorageService

Core service for storing and managing artifacts on disk.

```typescript
import { ArtifactStorageService, Artifact } from './artifact-storage.service';

const storage = new ArtifactStorageService({
  baseDir: './artifacts',
  maxSizeBytes: 100 * 1024 * 1024, // 100MB max
  retentionMs: 90 * 24 * 60 * 60 * 1000, // 90 days
});

// Store artifact
const artifact: Artifact = {
  metadata: {
    artifactId: 'report-001',
    contractId: 'CABC123',
    artifactType: 'report',
    format: 'json',
    network: 'testnet',
    networkPassphrase: 'Test SDF Network',
    ledgerSequence: 12345,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    generatedBy: 'gas-analyzer',
    toolVersion: '1.0.0',
    sizeBytes: 0,
    tags: ['audit', 'security'],
  },
  content: { /* report data */ },
};

await storage.storeArtifact(artifact);
```

### 2. ArtifactRetriever

High-level interface for retrieving artifacts with caching support.

```typescript
import { ArtifactRetriever } from './artifact-retriever';

const retriever = new ArtifactRetriever(storage, {
  enableCache: true,
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  maxCacheSize: 100,
});

// Get artifact
const artifact = await retriever.getArtifact('CABC123', 'report-001');

// Get latest artifact of type
const latest = await retriever.getLatestArtifact('CABC123', 'report');

// Get artifacts by type
const reports = await retriever.getArtifactsByType('CABC123', 'report', 10);

// Get artifacts by tags
const tagged = await retriever.getArtifactsByTags('CABC123', ['security']);

// Search with complex query
const results = await retriever.searchArtifacts({
  contractId: 'CABC123',
  artifactType: 'report',
  network: 'mainnet',
  createdAfter: Date.now() - 7 * 24 * 60 * 60 * 1000,
});
```

### 3. MetadataManager

Manages artifact metadata indexing and searching.

```typescript
import { MetadataManager } from './metadata-manager';

const manager = new MetadataManager('./artifacts');

// Find by criteria
const artifacts = manager.findByCriteria({
  contractId: 'CABC123',
  artifactType: 'report',
  network: 'testnet',
});

// Get by type
const reports = manager.getMetadataByType('report');

// Get by tags
const tagged = manager.getMetadataByTags(['security']);

// Get statistics
const stats = manager.getStatistics();
```

## Usage Examples

### Basic Usage

```typescript
import { initializeArtifactStorage } from './index';

const { storageService, retriever, metadataManager } = 
  initializeArtifactStorage('./artifacts');

// Store an artifact
const artifact = {
  metadata: {
    artifactId: 'analysis-001',
    contractId: 'CABC123',
    artifactType: 'analysis',
    format: 'json',
    network: 'testnet',
    networkPassphrase: 'Test SDF Network',
    ledgerSequence: 12345,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    generatedBy: 'analyzer',
    toolVersion: '1.0.0',
    sizeBytes: 0,
    description: 'Gas optimization analysis',
    tags: ['gas', 'optimization'],
  },
  content: {
    totalGasUsed: 50000,
    optimizationPotential: '15%',
    recommendations: ['Remove unused variables', 'Optimize loops'],
  },
};

const result = await storageService.storeArtifact(artifact);
if (result.success) {
  console.log(`Stored artifact at: ${result.filePath}`);
}
```

### Querying Artifacts

```typescript
// Get all artifacts for a contract
const contractArtifacts = await retriever.getContractArtifacts('CABC123');

// Get latest report
const latestReport = await retriever.getLatestArtifact('CABC123', 'report');

// Get artifacts in date range
const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const recent = await retriever.getArtifactsInDateRange('CABC123', weekAgo, Date.now());

// Search with advanced query
const query = {
  contractId: 'CABC123',
  artifactType: 'report',
  network: 'mainnet',
  tags: ['security'],
  createdAfter: weekAgo,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  limit: 10,
};

const results = await storageService.queryArtifacts(query);
```

### Batch Operations

```typescript
// Store multiple artifacts at once
const artifacts = [
  { metadata: { /* ... */ }, content: { /* ... */ } },
  { metadata: { /* ... */ }, content: { /* ... */ } },
  { metadata: { /* ... */ }, content: { /* ... */ } },
];

const batchResult = await storageService.storeArtifactBatch(artifacts);
console.log(`Stored: ${batchResult.succeeded}, Failed: ${batchResult.failed}`);
```

### Cleanup and Maintenance

```typescript
// Clean up expired artifacts
const cleanupResult = await storageService.cleanupExpiredArtifacts();
console.log(`Cleaned: ${cleanupResult.succeeded} artifacts`);

// Get storage statistics
const stats = storageService.getStorageStatistics();
console.log(`Total artifacts: ${stats.totalArtifacts}`);
console.log(`Total size: ${(stats.totalSizeBytes / 1024 / 1024).toFixed(2)}MB`);
console.log(`By type: ${JSON.stringify(stats.byType)}`);

// Rebuild metadata index
metadataManager.rebuildIndex();

// Clean orphaned metadata
const removed = metadataManager.cleanupOrphanedMetadata();
console.log(`Removed ${removed} orphaned metadata files`);
```

## Types

### ArtifactMetadata

```typescript
interface ArtifactMetadata {
  artifactId: string;
  contractId: string;
  artifactType: 'report' | 'snapshot' | 'analysis' | 'metrics' | 
                'recommendations' | 'security_audit' | 'performance_profile';
  format: 'json' | 'markdown' | 'html' | 'csv' | 'binary';
  network: 'testnet' | 'mainnet' | 'standalone';
  networkPassphrase: string;
  ledgerSequence: number;
  createdAt: number;
  updatedAt: number;
  description?: string;
  tags?: string[];
  generatedBy: string;
  toolVersion: string;
  sizeBytes: number;
  checksum?: string;
  expiresAt?: number;
  relatedArtifacts?: string[];
}
```

### ArtifactQuery

```typescript
interface ArtifactQuery {
  artifactId?: string;
  contractId?: string;
  artifactType?: ArtifactMetadata["artifactType"];
  network?: ArtifactMetadata["network"];
  tags?: string[];
  createdAfter?: number;
  createdBefore?: number;
  generatedBy?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'sizeBytes';
  sortOrder?: 'asc' | 'desc';
}
```

## Configuration

### ArtifactStorageConfig

```typescript
interface ArtifactStorageConfig {
  baseDir: string;                      // Storage directory
  enableCompression: boolean;            // Compress large artifacts
  maxSizeBytes: number;                 // Maximum artifact size
  retentionMs: number;                  // Auto-deletion after time
  verifyChecksum: boolean;              // Verify data integrity
  createBackups: boolean;               // Create backup copies
  backupDir?: string;                   // Backup directory
}
```

### ArtifactRetrievalConfig

```typescript
interface ArtifactRetrievalConfig {
  enableCache?: boolean;                 // In-memory caching
  cacheTtlMs?: number;                  // Cache time-to-live
  maxCacheSize?: number;                // Max cached items
}
```

## Directory Structure

```
artifacts/
├── CONTRACT_ID/
│   ├── 2024-01-15/
│   │   ├── artifact-001/
│   │   │   ├── artifact
│   │   │   └── metadata.json
│   │   └── artifact-002/
│   │       ├── artifact
│   │       └── metadata.json
│   └── 2024-01-14/
│       └── artifact-003/
│           ├── artifact
│           └── metadata.json
├── backups/
│   └── CONTRACT_ID/
│       └── artifact-001-1705326000000/
│           ├── artifact
│           └── metadata.json
├── .metadata.json         # Central metadata index
└── .index.json           # Quick lookup index
```

## Best Practices

1. **Tag artifacts appropriately** - Use consistent tags for easy searching and categorization
2. **Monitor storage size** - Regularly check statistics and clean up old artifacts
3. **Use meaningful descriptions** - Include context about the artifact in the description field
4. **Verify checksums** - Enable checksum verification for critical artifacts
5. **Set expiration times** - Use `expiresAt` for temporary artifacts
6. **Batch operations** - Use batch methods for multiple artifacts
7. **Cache configuration** - Adjust cache settings based on access patterns
8. **Backup important artifacts** - Enable backups for critical data

## Error Handling

```typescript
try {
  const result = await storageService.storeArtifact(artifact);
  if (!result.success) {
    console.error(`Storage failed: ${result.error}`);
  }
} catch (error) {
  console.error(`Storage error: ${error}`);
}

try {
  const artifact = await retriever.getArtifact(contractId, artifactId);
  if (!artifact) {
    console.warn('Artifact not found');
  }
} catch (error) {
  console.error(`Retrieval error: ${error}`);
}
```

## Performance Considerations

- Enable caching for frequently accessed artifacts
- Use queries with filters to reduce returned data
- Batch store operations when handling multiple artifacts
- Set appropriate retention times to manage disk usage
- Consider compression for large artifacts
- Monitor cache statistics and adjust max cache size as needed

## Testing

Run the test suite:

```bash
npm test -- src/storage/artifacts/stellar/__tests__/artifact-storage.spec.ts
```

Tests cover:
- Storing and retrieving artifacts
- Duplicate detection and overwriting
- Querying with various filters
- Batch operations
- Statistics tracking
- Deletion and cleanup
- Caching behavior
- Metadata management
