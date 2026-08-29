export interface ContractMetadata {
  name: string;
  description: string;
  version: string;
  traits: string[];
  functions: FunctionMetadata[];
  storage: StorageMetadata[];
  events: string[];
  dependencies: string[];
  complexity: {
    totalFunctions: number;
    totalTraits: number;
    totalEvents: number;
    totalStorageKeys: number;
    score: number;
  };
}

export interface FunctionMetadata {
  name: string;
  visibility: 'public' | 'private' | 'internal';
  parameters: ParameterMetadata[];
  returnType: string;
  hasAuth: boolean;
  line: number;
}

export interface ParameterMetadata {
  name: string;
  type: string;
  isAddress: boolean;
}

export interface StorageMetadata {
  key: string;
  type: string;
  persistence: 'instance' | 'persistent' | 'temporary';
  access: 'read' | 'write' | 'read-write';
}

export interface MetadataSummary {
  contractName: string;
  totalFunctions: number;
  totalTraits: number;
  storageKeys: number;
  dependencies: string;
  keyInsights: string[];
}

export interface MetadataExtractorConfig {
  inferDescriptions: boolean;
  includePrivateFunctions: boolean;
}
