export interface KBRule {
  id: string;
  name: string;
  description: string;
  explanation: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'Security' | 'Optimization' | 'Upgradeability' | 'Quality';
  remediation: string;
  documentationUrl: string;
  tags: string[];
}

export interface SearchOptions {
  category?: string;
  severity?: string;
  limit?: number;
}
