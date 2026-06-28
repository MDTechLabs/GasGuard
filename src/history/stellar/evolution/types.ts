export interface VersionChange {
  version: string;
  date: string;
  changeType: 'added' | 'modified' | 'deprecated' | 'removed';
  component: string;
  description: string;
  author: string;
}

export interface EvolutionSnapshot {
  version: string;
  totalContracts: number;
  totalFunctions: number;
  totalTraits: number;
  complexityScore: number;
  dependencies: string[];
}

export interface EvolutionReport {
  contractName: string;
  versions: VersionChange[];
  snapshots: EvolutionSnapshot[];
  currentComplexity: number;
  complexityTrend: 'increasing' | 'stable' | 'decreasing';
  growthRate: number;
  recommendations: string[];
  summary: string;
}

export interface EvolutionConfig {
  trackDependencies: boolean;
  alertOnBreakingChanges: boolean;
  maxHistoryVersions: number;
}
