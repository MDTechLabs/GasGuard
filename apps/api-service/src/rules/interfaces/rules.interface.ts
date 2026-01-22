export type RuleSeverity = 'error' | 'warning' | 'info';
export type RuleCategory =
  | 'storage-optimization'
  | 'gas-optimization'
  | 'security'
  | 'best-practices';

export interface RuleDefinition {
  name: string;
  description: string;
  severity: RuleSeverity;
  category: RuleCategory;
  enabled: boolean;
  documentationUrl?: string;
}
