import { FeatureExtractor } from './feature-extractor';
import { GasPredictor } from './predictor';

describe('FeatureExtractor', () => {
  let extractor: FeatureExtractor;

  beforeEach(() => {
    extractor = new FeatureExtractor();
  });

  it('should return baseline feature metrics for empty code', () => {
    const features = extractor.extractFeatures('');
    expect(features.cyclomaticComplexity).toBe(1);
    expect(features.maxLoopDepth).toBe(0);
    expect(features.variableCount).toBe(0);
    expect(features.storageAccesses).toBe(0);
    expect(features.memoryAllocations).toBe(0);
  });

  it('should extract features accurately from simple contract code', () => {
    const code = `
      function transfer(address to, uint256 amount) public returns (bool) {
        require(to != address(0), "Invalid recipient");
        return true;
      }
    `;
    const features = extractor.extractFeatures(code);
    expect(features.cyclomaticComplexity).toBe(2); // base 1 + require 1
    expect(features.variableCount).toBe(2); // address to, uint256 amount
    expect(features.maxLoopDepth).toBe(0);
  });

  it('should detect loop depth, storage accesses, and memory allocations in complex functions', () => {
    const code = `
      function complexDistribute(address[] memory recipients, uint256 baseAmount) public storage {
        uint256 total = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
          for (uint256 j = 0; j < 2; j++) {
            if (recipients[i] != address(0)) {
              balances[recipients[i]] += baseAmount;
              bytes memory data = abi.encode(recipients[i], baseAmount);
            }
          }
        }
      }
    `;
    const features = extractor.extractFeatures(code);
    expect(features.cyclomaticComplexity).toBeGreaterThan(3);
    expect(features.maxLoopDepth).toBe(2);
    expect(features.variableCount).toBeGreaterThan(2);
    expect(features.storageAccesses).toBeGreaterThan(0);
    expect(features.memoryAllocations).toBeGreaterThan(0);
  });
});

describe('GasPredictor', () => {
  let predictor: GasPredictor;

  beforeEach(() => {
    predictor = new GasPredictor();
  });

  it('should evaluate feature vectors and return a Gas Complexity Index score', () => {
    const result = predictor.predict({
      cyclomaticComplexity: 2,
      maxLoopDepth: 0,
      variableCount: 2,
      storageAccesses: 1,
      memoryAllocations: 0,
    });

    // Score = 5.0 (intercept) + 2*2.5 + 0*8.0 + 2*1.2 + 1*6.5 + 0*3.0 = 5 + 5 + 2.4 + 6.5 = 18.9
    expect(result.complexityIndex).toBe(18.9);
    expect(result.baselineAverage).toBe(25.0);
    expect(result.isAnomaly).toBe(false);
    expect(result.deviationPercentage).toBeLessThan(0);
  });

  it('should flag anomalies when complexity index strays significantly from baseline', () => {
    const complexCode = `
      function heavyLoop(address[] memory users) public {
        for (uint256 i = 0; i < users.length; i++) {
          for (uint256 j = 0; j < users.length; j++) {
            if (users[i] != address(0) && users[j] != address(0)) {
              userScores[users[i]] += balances[users[j]];
              bytes memory temp = abi.encodePacked(users[i], users[j]);
            }
          }
        }
      }
    `;

    const result = predictor.predict(complexCode);
    expect(result.isAnomaly).toBe(true);
    expect(result.complexityIndex).toBeGreaterThan(result.baselineAverage);
    expect(result.deviationPercentage).toBeGreaterThanOrEqual(50.0);
    expect(result.recommendation).toBeDefined();
    expect(typeof result.recommendation).toBe('string');
  });

  it('should support custom regression weights and custom thresholds', () => {
    const customPredictor = new GasPredictor(
      { intercept: 10.0, storageAccesses: 10.0 },
      20.0,
      40.0
    );

    const weights = customPredictor.getWeights();
    expect(weights.intercept).toBe(10.0);
    expect(weights.storageAccesses).toBe(10.0);

    const result = customPredictor.predict({
      cyclomaticComplexity: 1,
      maxLoopDepth: 0,
      variableCount: 1,
      storageAccesses: 3,
      memoryAllocations: 0,
    });

    // Score = 10 + 2.5 + 1.2 + 30 = 43.7 >= 40 threshold
    expect(result.complexityIndex).toBe(43.7);
    expect(result.isAnomaly).toBe(true);
  });
});
