import fs from "fs-extra";
import path from "path";

export interface Finding {
  file: string;
  line: number;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  suggestion?: string;
  gasSavings?: number;
  confidence?: number;
}

export interface ScanResult {
  timestamp: string;
  scanPath: string;
  totalFiles: number;
  scannedFiles: number;
  findings: Finding[];
  summary: Summary;
}

export interface Summary {
  totalViolations: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  byRule: Record<string, number>;
  totalGasSavings: number;
}

// SARIF Types
interface SarifLog {
  version: string;
  $schema: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: SarifTool;
  results: SarifResult[];
  invocations?: SarifInvocation[];
}

interface SarifTool {
  driver: SarifToolComponent;
}

interface SarifToolComponent {
  name: string;
  version: string;
  informationUri?: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  shortDescription: SarifMessage;
  fullDescription?: SarifMessage;
  help?: SarifMessage;
  properties?: SarifRuleProperties;
}

interface SarifRuleProperties {
  category: string;
  precision: string;
  "security-severity"?: string;
}

interface SarifMessage {
  text: string;
}

interface SarifResult {
  ruleId: string;
  level: string;
  message: SarifMessage;
  locations: SarifLocation[];
  fixes?: SarifFix[];
}

interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region: SarifRegion;
}

interface SarifArtifactLocation {
  uri: string;
}

interface SarifRegion {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

interface SarifFix {
  description: SarifMessage;
  artifactChanges: SarifArtifactChange[];
}

interface SarifArtifactChange {
  artifactLocation: SarifArtifactLocation;
  replacements: SarifReplacement[];
}

interface SarifReplacement {
  region: SarifRegion;
  insertedContent?: SarifInsertedContent;
}

interface SarifInsertedContent {
  text: string;
}

interface SarifInvocation {
  startTimeUtc: string;
  endTimeUtc: string;
  executionSuccessful: boolean;
}

export async function generateSarifReport(
  results: ScanResult,
  outputPath: string,
): Promise<void> {
  const log = createSarifLog(results);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.ensureDir(outputDir);

  // Write SARIF report
  await fs.writeJson(outputPath, log, { spaces: 2 });
}

function createSarifLog(results: ScanResult): SarifLog {
  const rules = extractRules(results.findings);
  const sarifResults = results.findings.map((finding) =>
    convertFinding(finding),
  );

  const startTime = new Date(results.timestamp);
  const endTime = new Date(startTime.getTime() + 1000); // Simplified timing

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "GasGuard",
            version: "1.0.0",
            informationUri: "https://github.com/Nabeelahh/GasGuard",
            rules,
          },
        },
        results: sarifResults,
        invocations: [
          {
            startTimeUtc: startTime.toISOString(),
            endTimeUtc: endTime.toISOString(),
            executionSuccessful: true,
          },
        ],
      },
    ],
  };
}

function extractRules(findings: Finding[]): SarifRule[] {
  const rulesMap = new Map<string, SarifRule>();

  for (const finding of findings) {
    if (!rulesMap.has(finding.ruleId)) {
      const category = categorizeRule(finding.ruleId);
      const severity = severityToSecurityLevel(finding.severity);

      rulesMap.set(finding.ruleId, {
        id: finding.ruleId,
        shortDescription: {
          text: getRuleShortDescription(finding.ruleId),
        },
        fullDescription: {
          text: getRuleFullDescription(finding.ruleId),
        },
        help: {
          text: finding.message,
        },
        properties: {
          category,
          precision: "medium",
          "security-severity": severity,
        },
      });
    }
  }

  return Array.from(rulesMap.values());
}

function convertFinding(finding: Finding): SarifResult {
  const level = severityToLevel(finding.severity);
  const fixes = finding.suggestion
    ? [
        {
          description: {
            text: "Suggested fix",
          },
          artifactChanges: [
            {
              artifactLocation: {
                uri: finding.file,
              },
              replacements: [
                {
                  region: {
                    startLine: finding.line,
                    startColumn: undefined,
                    endLine: finding.line,
                    endColumn: undefined,
                  },
                  insertedContent: {
                    text: finding.suggestion,
                  },
                },
              ],
            },
          ],
        },
      ]
    : undefined;

  return {
    ruleId: finding.ruleId,
    level,
    message: {
      text: finding.message,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: finding.file,
          },
          region: {
            startLine: finding.line,
            startColumn: undefined,
            endLine: finding.line,
            endColumn: undefined,
          },
        },
      },
    ],
    fixes,
  };
}

function severityToLevel(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "note";
    default:
      return "note";
  }
}

function severityToSecurityLevel(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "9.0";
    case "error":
      return "7.0";
    case "warning":
      return "4.0";
    case "info":
      return "0.0";
    default:
      return "0.0";
  }
}

function categorizeRule(ruleId: string): string {
  if (ruleId.startsWith("SOL-")) return "solidity";
  if (ruleId.startsWith("VY-")) return "vyper";
  if (ruleId.startsWith("RS-")) return "rust";
  if (ruleId.startsWith("SOR-")) return "soroban";
  return "general";
}

function getRuleShortDescription(ruleId: string): string {
  switch (ruleId) {
    case "SOL-001":
      return "Use bytes32 instead of string for fixed-length data";
    case "SOL-002":
      return "Use uint256 instead of uint";
    case "SOL-003":
      return "Use calldata instead of memory for read-only arguments";
    default:
      return `Gas optimization rule ${ruleId}`;
  }
}

function getRuleFullDescription(ruleId: string): string {
  switch (ruleId) {
    case "SOL-001":
      return "Using bytes32 instead of string for fixed-length data can save gas";
    case "SOL-002":
      return "Using uint256 instead of uint can save gas by avoiding type conversion";
    case "SOL-003":
      return "Using calldata instead of memory for read-only arguments can save gas";
    default:
      return `Gas optimization rule: ${ruleId}`;
  }
}
