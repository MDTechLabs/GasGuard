export interface StellarRegressionFixture {
  id: string;
  name: string;
  description: string;
  ruleId: string;
  input: string;
  expected: {
    detected: boolean;
    flaggedFunctions?: string[];
    weakRoles?: string[];
    violations?: Array<{ topicCount?: number; hasLargePayload?: boolean }>;
  };
  metadata: {
    category: string;
    regressionType: 'positive' | 'negative' | 'edge';
    language: string;
  };
}

export interface RegressionSuite {
  ruleId: string;
  name: string;
  fixtures: StellarRegressionFixture[];
}

export interface RegressionResult {
  fixture: StellarRegressionFixture;
  passed: boolean;
  actualDetected: boolean;
  detail: string;
}
