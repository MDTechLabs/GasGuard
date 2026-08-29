export interface SorobanFunctionInterface {
  name: string;
  signature: string;
  inputs: SorobanParameter[];
  outputs: SorobanParameter[];
  documentation?: string;
  entryPoint?: boolean;
}

export interface SorobanParameter {
  name: string;
  type: SorobanType;
  documentation?: string;
}

export interface SorobanType {
  name: string;
  isPrimitive: boolean;
  isVec?: boolean;
  isOption?: boolean;
  isMap?: boolean;
  innerType?: SorobanType;
}

export interface SorobanContractInterface {
  id: string;
  name: string;
  version: string;
  contractId?: string;
  functions: SorobanFunctionInterface[];
  structs: SorobanStructInterface[];
  events: SorobanEventInterface[];
  metadata: {
    author?: string;
    description?: string;
    license?: string;
    sourceUrl?: string;
  };
}

export interface SorobanStructInterface {
  name: string;
  fields: SorobanParameter[];
  documentation?: string;
}

export interface SorobanEventInterface {
  name: string;
  topics: string[];
  data: SorobanParameter[];
  documentation?: string;
}
