import { RuleDefinition } from "./interfaces/rules.interface";

export const RULE_METADATA_SCHEMA_VERSION = 1;
const DOCS_BASE = "https://gasguard.dev/rules";

export interface RuleMetadataEntry {
  /** Stable identifier (the rule name). */
  id: string;
  severity: RuleDefinition["severity"];
  category: RuleDefinition["category"];
  description: string;
  enabled: boolean;
  remediation: {
    /** Remediation reference URLs; the rule's documentationUrl when set, otherwise the conventional docs URL. */
    references: string[];
  };
}

export interface RuleMetadataDocument {
  schemaVersion: number;
  rules: RuleMetadataEntry[];
}

/**
 * Builds a machine-readable, deterministic (sorted by id) metadata document
 * from existing rule definitions.
 */
export function buildRuleMetadata(
  rules: RuleDefinition[],
): RuleMetadataDocument {
  const entries = rules.map((rule) => ({
    id: rule.name,
    severity: rule.severity,
    category: rule.category,
    description: rule.description,
    enabled: rule.enabled,
    remediation: {
      references: [
        rule.documentationUrl ?? `${DOCS_BASE}/${encodeURIComponent(rule.name)}`,
      ],
    },
  }));
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schemaVersion: RULE_METADATA_SCHEMA_VERSION, rules: entries };
}
