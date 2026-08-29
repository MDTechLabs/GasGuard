import { CodeFeatures, FeatureExtractor } from './feature-extractor';

export interface RegressionWeights {
  cyclomaticComplexity: number;
  maxLoopDepth: number;
  variableCount: number;
  storageAccesses: number;
  memoryAllocations: number;
  intercept: number;
}

export interface PredictionResult {
  features: CodeFeatures;
  complexityIndex: number;
  baselineAverage: number;
  isAnomaly: boolean;
  deviationPercentage: number;
  recommendation?: string;
}

export class GasPredictor {
  private readonly weights: RegressionWeights;
  private readonly baselineAverage: number;
  private readonly anomalyThreshold: number;
  private readonly featureExtractor: FeatureExtractor;

  public static readonly DEFAULT_WEIGHTS: RegressionWeights = {
    cyclomaticComplexity: 2.5,
    maxLoopDepth: 8.0,
    variableCount: 1.2,
    storageAccesses: 6.5,
    memoryAllocations: 3.0,
    intercept: 5.0,
  };

  constructor(
    customWeights?: Partial<RegressionWeights>,
    baselineAverage = 25.0,
    anomalyThreshold = 55.0
  ) {
    this.weights = {
      ...GasPredictor.DEFAULT_WEIGHTS,
      ...customWeights,
    };
    this.baselineAverage = baselineAverage;
    this.anomalyThreshold = anomalyThreshold;
    this.featureExtractor = new FeatureExtractor();
  }

  /**
   * Predicts gas complexity index for code or extracted feature vectors.
   * @param input Source code string or pre-extracted CodeFeatures object
   */
  public predict(input: string | CodeFeatures): PredictionResult {
    const features: CodeFeatures =
      typeof input === 'string' ? this.featureExtractor.extractFeatures(input) : input;

    const rawScore =
      this.weights.intercept +
      features.cyclomaticComplexity * this.weights.cyclomaticComplexity +
      features.maxLoopDepth * this.weights.maxLoopDepth +
      features.variableCount * this.weights.variableCount +
      features.storageAccesses * this.weights.storageAccesses +
      features.memoryAllocations * this.weights.memoryAllocations;

    const complexityIndex = Math.round(rawScore * 100) / 100;
    const deviationPercentage =
      Math.round(((complexityIndex - this.baselineAverage) / this.baselineAverage) * 10000) / 100;
    const isAnomaly = complexityIndex >= this.anomalyThreshold || deviationPercentage >= 50.0;

    let recommendation: string | undefined;
    if (isAnomaly) {
      const issues: string[] = [];
      if (features.maxLoopDepth >= 2) {
        issues.push('Refactor nested loop structures to decrease iteration depth');
      }
      if (features.storageAccesses >= 3) {
        issues.push('Cache state variables in memory to reduce SLOAD/SSTORE operations');
      }
      if (features.cyclomaticComplexity >= 8) {
        issues.push('Simplify function branching logic and split into modular sub-functions');
      }

      recommendation =
        issues.length > 0
          ? issues.join('; ')
          : 'High gas complexity index detected; review code block for gas optimizations.';
    }

    return {
      features,
      complexityIndex,
      baselineAverage: this.baselineAverage,
      isAnomaly,
      deviationPercentage,
      recommendation,
    };
  }

  public getWeights(): RegressionWeights {
    return { ...this.weights };
  }
}
