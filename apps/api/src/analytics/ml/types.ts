export type EventRecord = {
  userId: string;
  action: string;
  timestamp: number;
  metadata?: Record<string, any>;
};

export type FeatureVector = {
  frequency: number;
  timeGapAvg: number;
  errorRate: number;
};

export type AnomalyResult = {
  userId: string;
  score: number;
  isAnomaly: boolean;
};
