export interface InitFlow {
  functionName: string;
  hasGuard: boolean;
  storageKeys: string[];
  line: number;
}

export interface UpgradeFlow {
  functionName: string;
  hasAccessControl: boolean;
  isWasm: boolean;
  line: number;
}

export interface LifecycleIssue {
  severity: 'low' | 'medium' | 'high';
  message: string;
  line?: number;
}

export interface LifecycleReport {
  contractName: string;
  initFlows: InitFlow[];
  upgradeFlows: UpgradeFlow[];
  issues: LifecycleIssue[];
  summary: string;
}
