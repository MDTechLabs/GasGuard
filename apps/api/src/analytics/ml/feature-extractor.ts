import { EventRecord, FeatureVector } from "./types";

export function extractFeatures(events: EventRecord[]): FeatureVector {
  if (!events.length) {
    return { frequency: 0, timeGapAvg: 0, errorRate: 0 };
  }

  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const gaps: number[] = [];
  let errors = 0;

  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].timestamp - sorted[i - 1].timestamp);
  }

  for (const e of events) {
    if (e.metadata?.error === true) errors++;
  }

  return {
    frequency: events.length,
    timeGapAvg: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
    errorRate: errors / events.length,
  };
}
