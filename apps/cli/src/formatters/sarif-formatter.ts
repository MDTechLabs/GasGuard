/**
 * Maps GasGuard rule matches into a SARIF v2.1.0 log so results can be ingested
 * by GitHub code scanning and other static-analysis dashboards.
 *
 * The types below are a self-contained subset of the SARIF 2.1.0 schema — just
 * the fields GasGuard emits — so this formatter carries no external dependency.
 */

export type RuleSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface RuleMatch {
  ruleId: string;
  ruleName?: string;
  message: string;
  file: string;
  line: number;
  column?: number;
  severity: RuleSeverity;
  gasSavings?: number;
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: SarifRun[];
}

interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

interface SarifDriver {
  name: string;
  informationUri: string;
  version: string;
  rules: SarifReportingDescriptor[];
}

interface SarifReportingDescriptor {
  id: string;
  name?: string;
  shortDescription: { text: string };
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: { startLine: number; startColumn?: number };
  };
}

type SarifLevel = "error" | "warning" | "note";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

const TOOL_INFORMATION_URI = "https://github.com/MDTechLabs/GasGuard";

/** Map a GasGuard severity to a SARIF result level. */
export function toSarifLevel(severity: RuleSeverity): SarifLevel {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
    case "low":
      return "warning";
    case "info":
      return "note";
    default:
      return "warning";
  }
}

/** Build a SARIF 2.1.0 log from GasGuard rule matches. */
export function toSarif(matches: RuleMatch[], toolVersion = "0.0.0"): SarifLog {
  const rulesById = new Map<string, SarifReportingDescriptor>();
  for (const match of matches) {
    if (!rulesById.has(match.ruleId)) {
      rulesById.set(match.ruleId, {
        id: match.ruleId,
        name: match.ruleName ?? match.ruleId,
        shortDescription: { text: match.ruleName ?? match.ruleId },
      });
    }
  }

  const results: SarifResult[] = matches.map((match) => ({
    ruleId: match.ruleId,
    level: toSarifLevel(match.severity),
    message: { text: match.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: match.file },
          region: {
            startLine: match.line,
            ...(match.column !== undefined
              ? { startColumn: match.column }
              : {}),
          },
        },
      },
    ],
  }));

  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: "GasGuard",
            informationUri: TOOL_INFORMATION_URI,
            version: toolVersion,
            rules: Array.from(rulesById.values()),
          },
        },
        results,
      },
    ],
  };
}

/** Serialize a SARIF log to a pretty-printed JSON string. */
export function toSarifString(
  matches: RuleMatch[],
  toolVersion = "0.0.0",
): string {
  return `${JSON.stringify(toSarif(matches, toolVersion), null, 2)}\n`;
}
