import { FeatureVector, AnomalyResult } from "./types";

type Stats = {
  mean: FeatureVector;
  std: FeatureVector;
};

function zScore(value: number, mean: number, std: number) {
  if (std === 0) return 0;
  return (value - mean) / std;
}

export class MLDetector {
  private stats: Stats;

  constructor(trainingData: FeatureVector[]) {
    this.stats = this.computeStats(trainingData);
  }

  private computeStats(data: FeatureVector[]): Stats {
    const keys: (keyof FeatureVector)[] = [
      "frequency",
      "timeGapAvg",
      "errorRate",
    ];

    const mean: any = {};
    const std: any = {};

    for (const key of keys) {
      const values = data.map((d) => d[key]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;

      mean[key] = avg;

      const variance =
        values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;

      std[key] = Math.sqrt(variance);
    }

    return { mean, std };
  }

  public predict(userId: string, input: FeatureVector): AnomalyResult {
    const score =
      Math.abs(
        zScore(
          input.frequency,
          this.stats.mean.frequency,
          this.stats.std.frequency,
        ),
      ) +
      Math.abs(
        zScore(
          input.timeGapAvg,
          this.stats.mean.timeGapAvg,
          this.stats.std.timeGapAvg,
        ),
      ) +
      Math.abs(
        zScore(
          input.errorRate,
          this.stats.mean.errorRate,
          this.stats.std.errorRate,
        ),
      );

    const isAnomaly = score > 3; // threshold (tunable)

    return {
      userId,
      score,
      isAnomaly,
    };
  }
}
