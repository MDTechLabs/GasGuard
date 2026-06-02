import { MLDetector } from "./detector";
import { extractFeatures } from "./feature-extractor";
import { EventRecord } from "./types";

export class AnalysisMLPipeline {
  private detector: MLDetector;

  constructor(trainingData: any[]) {
    this.detector = new MLDetector(trainingData);
  }

  run(userId: string, events: EventRecord[]) {
    const features = extractFeatures(events);

    const result = this.detector.predict(userId, features);

    return {
      userId,
      features,
      anomaly: result,
    };
  }
}
