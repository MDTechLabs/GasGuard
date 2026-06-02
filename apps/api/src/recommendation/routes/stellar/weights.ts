import { RouteRecommendationOptions } from "./types";

export const defaultWeights: Required<RouteRecommendationOptions> = {
  weightCost: 0.5,
  weightSpeed: 0.4,
  weightReliability: 0.1,
};
