# GasGuard Finding Metadata System

## Overview

The Finding Metadata System provides structured, standardized information about every optimization finding in GasGuard. It ensures consistent representation of severity, impact estimates, and educational resources across all CLI and API outputs.

## Architecture

### Core Components

#### 1. **FindingMetadata Interface** (`finding-metadata.interface.ts`)

The central data structure containing:

- **Severity & Confidence**: Assessment of the issue
- **Impact Estimates**: Quantified gas/storage savings
- **Educational Links**: Learning resources
- **Mitigation Steps**: How to fix the issue
- **Related Information**: Tags, affected aspects, related rules

```typescript
interface FindingMetadata {
  severity: SeverityLevel;           // critical, high, medium, low, info
  confidence: ConfidenceLevel;       // critical, high, medium, low, uncertain
  confidenceScore: number;           // 0-100
  impacts: ImpactEstimate[];         // Array of quantified impacts
  educationalLinks: EducationalLink[]; // Learning resources
  affectedAspects: string[];         // System areas affected
  mitigation?: string;               // Fix instructions
  relatedRules?: string[];           // Connected rules
  tags?: string[];                   // Custom categorization
}
```

#### 2. **FindingMetadataBuilder** (`finding-metadata.interface.ts`)

Fluent API for safely constructing metadata objects:

```typescript
const metadata = new FindingMetadataBuilder()
  .setSeverity(SeverityLevel.HIGH)
  .setConfidence(ConfidenceLevel.HIGH, 92)
  .addImpact({
    type: ImpactType.GAS,
    amount: 5000,
    unit: 'gas',
    description: 'Gas cost reduction from optimized storage access'
  })
  .addEducationalLink({
    title: 'Solidity Docs',
    url: 'https://docs.soliditylang.org/...',
    source: 'documentation'
  })
  .setAffectedAspects(['storage-layout', 'gas-usage'])
  .setMitigation('Reorder state variables for better packing')
  .build();
```

#### 3. **FindingMetadataFactory** (`finding-metadata.factory.ts`)

Factory for consistent metadata creation with a built-in rule catalog:

```typescript
// Create metadata for a known rule
const metadata = FindingMetadataFactory.createForRule('unused-state-variables');

// List all available rules
const rules = FindingMetadataFactory.getAvailableRules();

// Validate metadata
const validation = FindingMetadataFactory.validate(metadata);
```

**Built-in Rule Configurations:**
- `unused-state-variables`
- `redundant-external`
- `storage-layout-optimization`
- `function-complexity`

#### 4. **CLI Formatters**

##### MetadataCliFormatter (`metadata-cli.formatter.ts`)

Rich terminal output with formatting:

```typescript
// Detailed finding with all metadata
const output = MetadataCliFormatter.formatFindingWithMetadata(violation);

// Summary with severity breakdown
const summary = MetadataCliFormatter.formatSummaryWithMetadata(violations);

// JSON for programmatic access
const json = MetadataCliFormatter.toJSON(violation);
```

##### MetadataTableFormatter

Compact table view of findings:

```typescript
const table = MetadataTableFormatter.formatAsTable(violations);
```

#### 5. **Analysis Result Handler** (`analysis-result-handler.ts`)

High-level CLI command handler:

```typescript
// Display results in various formats
const output = AnalysisResultCliHandler.displayResults(violations, {
  format: 'detailed', // 'detailed', 'table', 'json'
  includeEducational: true,
  verbose: false
});

// Get recommendations based on metadata
const recommendations = AnalysisResultCliHandler.getRecommendations(violations);

// Export to JSON with full metadata
const json = AnalysisResultCliHandler.exportToJson(violations);
```

## Integration Points

### API Layer

**AnalyzerService** automatically attaches metadata to violations:

```typescript
async analyzeCode(code: string, source: string): Promise<AnalysisReport> {
  // ...
  const formattedViolations = this.formatViolations(scanResult.violations);
  // Metadata is automatically added in formatViolations()
  // ...
}
```

Response includes:

```json
{
  "violations": [
    {
      "ruleName": "unused-state-variables",
      "severity": "medium",
      "metadata": {
        "severity": "medium",
        "confidence": "critical",
        "confidenceScore": 98,
        "impacts": [
          {
            "type": "storage",
            "amount": 2500,
            "unit": "bytes",
            "description": "..."
          }
        ],
        "educationalLinks": [...],
        "affectedAspects": [...],
        "mitigation": "...",
        "tags": [...]
      }
    }
  ]
}
```

### CLI Layer

Use `AnalysisResultCliHandler` in CLI commands:

```typescript
async analyzeCommand(filePath: string, options: CliOptions) {
  const report = await this.analyzer.analyzeCode(code, filePath);
  
  const output = AnalysisResultCliHandler.displayResults(
    report.violations,
    {
      format: options.format,
      includeEducational: options.includeEducational
    }
  );
  
  console.log(output);
}
```

## Severity & Confidence Levels

### Severity (Issue Importance)
- **CRITICAL**: Must fix immediately; security/correctness issue
- **HIGH**: Significant impact; strong recommendation to fix
- **MEDIUM**: Noticeable impact; recommended to fix
- **LOW**: Minor impact; optional optimization
- **INFO**: Informational; no action required

### Confidence (Detection Reliability)
- **CRITICAL**: 95-100% confidence in detection
- **HIGH**: 80-95% confidence
- **MEDIUM**: 60-80% confidence
- **LOW**: 40-60% confidence
- **UNCERTAIN**: <40% confidence

## Impact Types

- **GAS**: Estimated gas savings (in gas units)
- **STORAGE**: Storage bytes saved
- **SECURITY**: Security improvements
- **MAINTAINABILITY**: Code quality improvements
- **PERFORMANCE**: Performance benefits

## Educational Resources

Each finding includes educational links to help developers understand the issue:

```typescript
interface EducationalLink {
  title: string;           // Link title
  url: string;            // Full URL
  source?: 'documentation' | 'blog' | 'standard' | 'best-practice' | 'security';
  description?: string;   // Brief description of content
}
```

## Example: Complete Finding Output

```
════════════════════════════════════════════════════════════════════════════════
⚠️  [UNUSED-STATE-VARIABLES]
Description: Found unused state variable that consumes storage

Severity: 🟡 MEDIUM | Confidence: ✓✓✓ CRITICAL (98%)

📊 Impact Estimates:
  • STORAGE: 2500 bytes
    └─ Unused state variables consume storage slots that cannot be reclaimed
  • GAS: 20000 (5000-50000) gas
    └─ Gas cost to read/write unused variables in initialization

🎯 Affected Aspects: state-storage, deployment-cost, runtime-gas

🔧 How to Fix:
  Remove the unused state variable declaration from the contract

📚 Learn More:
  • Solidity Storage Optimization [documentation]
    https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html
    └─ Official Solidity documentation on storage layout
  • Gas Optimization Best Practices [best-practice]
    https://blog.openzeppelin.com/smart-contract-gas-optimization-tips/
    └─ OpenZeppelin guide to smart contract gas optimization

🔗 Related Rules: uninitialized-state-variables, private-visibility

🏷️  Tags: storage-optimization, code-quality, removal

════════════════════════════════════════════════════════════════════════════════
```

## Adding New Rules

### Step 1: Define Metadata Configuration

Add to `RULE_METADATA_CATALOG` in `finding-metadata.factory.ts`:

```typescript
export const RULE_METADATA_CATALOG: Record<string, RuleMetadataConfig> = {
  'my-new-rule': {
    ruleName: 'my-new-rule',
    severity: SeverityLevel.MEDIUM,
    confidence: ConfidenceLevel.HIGH,
    confidenceScore: 85,
    impacts: [
      {
        type: ImpactType.GAS,
        amount: 1000,
        unit: 'gas',
        range: { min: 500, max: 2000 },
        description: 'Description of impact'
      }
    ],
    educationalLinks: [
      {
        title: 'Reference Title',
        url: 'https://example.com',
        source: 'documentation',
        description: 'What this resource teaches'
      }
    ],
    affectedAspects: ['aspect1', 'aspect2'],
    mitigation: 'How to fix this issue',
    relatedRules: ['other-rule'],
    tags: ['tag1', 'tag2']
  }
};
```

### Step 2: Use in Analysis

```typescript
const metadata = FindingMetadataFactory.createForRule('my-new-rule');
```

## Validation & Error Handling

The factory includes validation:

```typescript
const metadata = FindingMetadataFactory.createForRule('some-rule');
const validation = FindingMetadataFactory.validate(metadata);

if (!validation.valid) {
  console.error('Invalid metadata:', validation.errors);
}
```

## CLI Output Formats

### Detailed Format (Default)
Rich, educational output with full metadata and learning resources.

### Table Format
Compact overview of all findings in a table:
```
Rule                       │ Severity │ Confidence │ Line │ Gas Impact │ Storage Impact
───────────────────────────┼──────────┼────────────┼──────┼────────────┼──────────────
unused-state-variables     │ 🟡       │ 98%        │ 42   │ 20000gas   │ 2500bytes
redundant-external         │ 🟢       │ 85%        │ 15   │ 200gas     │ -
```

### JSON Format
Machine-readable format for programmatic processing:
```json
{
  "timestamp": "2024-01-23T...",
  "summary": {
    "total": 2,
    "critical": 0,
    "high": 0,
    "medium": 1,
    "low": 1,
    "info": 0
  },
  "findings": [...]
}
```

## Best Practices

1. **Always Set Confidence Score**: Helps users understand reliability
2. **Include Multiple Impacts**: Show gas, storage, and other benefits
3. **Add Educational Links**: Help users learn, not just fix
4. **Be Specific in Mitigation**: Actionable steps are most helpful
5. **Tag Appropriately**: Use consistent tags for filtering
6. **Validate Before Use**: Use `FindingMetadataFactory.validate()`

## Files Created

```
apps/api-service/src/
├── common/
│   ├── interfaces/
│   │   └── finding-metadata.interface.ts    # Core metadata definitions
│   ├── factories/
│   │   └── finding-metadata.factory.ts      # Metadata creation factory
│   ├── formatters/
│   │   └── metadata-cli.formatter.ts        # CLI output formatting
│   └── cli/
│       └── analysis-result-handler.ts       # High-level CLI handler
├── analyzer/
│   ├── analyzer.service.ts                  # Updated to attach metadata
│   └── interfaces/
│       └── analyzer.interface.ts            # Updated with metadata field
└── scanner/
    └── interfaces/
        └── scanner.interface.ts             # Updated RuleViolation interface
```

## Version

Current Metadata Schema Version: **1.0**

## Future Enhancements

- [ ] Metadata versioning for backward compatibility
- [ ] Custom metadata source plugins
- [ ] Metadata caching/optimization
- [ ] Multi-language educational resources
- [ ] User-defined impact estimates
- [ ] Metadata telemetry and analytics
