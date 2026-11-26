export type SolidityRegressionType =
  | "positive"
  | "negative"
  | "boundary"
  | "regression";

export interface SolidityRegressionFixture {
  id: string;
  name: string;
  description: string;
  auditSource: string;
  ruleId: string;
  solidityVersion: string;
  code: string;
  expected: {
    detected: boolean;
    count?: number;
    flaggedKinds?: string[];
  };
  metadata: {
    category: string;
    regressionType: SolidityRegressionType;
    tags: string[];
  };
}

export interface SolidityRegressionSuite {
  ruleId: string;
  name: string;
  fixtures: SolidityRegressionFixture[];
}

export interface SolidityRegressionResult {
  fixture: SolidityRegressionFixture;
  passed: boolean;
  actualDetected: boolean;
  findingCount: number;
  detail: string;
}
