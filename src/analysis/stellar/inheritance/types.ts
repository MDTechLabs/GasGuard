export interface TraitDefinition {
  name: string;
  methods: string[];
  superTraits: string[];
  line: number;
}

export interface TraitImplementation {
  traitName: string;
  contractName: string;
  methodsImplemented: string[];
  line: number;
}

export interface InheritanceHierarchy {
  trait: string;
  depth: number;
  implementations: TraitImplementation[];
  subTraits: string[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface InheritanceAnalysis {
  contractName: string;
  traitsUsed: string[];
  hierarchies: InheritanceHierarchy[];
  maxDepth: number;
  totalImplementations: number;
  issues: string[];
  summary: string;
}