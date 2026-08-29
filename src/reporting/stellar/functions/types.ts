export type FunctionVisibility = 'public' | 'private' | 'internal';

export interface ContractFunction {
  name: string;
  visibility: FunctionVisibility;
  params: string[];
  returnType: string | null;
  isConstructor: boolean;
  lineNumber: number;
}

export interface FunctionInventory {
  contractName: string;
  filePath: string;
  functions: ContractFunction[];
  publicCount: number;
  privateCount: number;
  internalCount: number;
  totalCount: number;
  generatedAt: Date;
}

export interface FunctionInventoryConfig {
  includePrivate: boolean;
}
