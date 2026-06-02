import { StellarRoute, RouteRecommendationOptions } from "./types";
import { defaultWeights } from "./weights";

function normalize(value: number, min: number, max: number) {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

export function scoreRoutes(
  routes: StellarRoute[],
  options: RouteRecommendationOptions = {},
) {
  const weights = { ...defaultWeights, ...options };

  const costs = routes.map((r) => r.estimatedCost);
  const times = routes.map((r) => r.estimatedTimeMs);
  const reliabilities = routes.map((r) => r.reliability ?? 0.5);

  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  return routes.map((route) => {
    const costScore = 1 - normalize(route.estimatedCost, minCost, maxCost);
    const speedScore = 1 - normalize(route.estimatedTimeMs, minTime, maxTime);
    const reliabilityScore = route.reliability ?? 0.5;

    const score =
      costScore * weights.weightCost +
      speedScore * weights.weightSpeed +
      reliabilityScore * weights.weightReliability;

    return {
      ...route,
      score,
    };
  });
}
