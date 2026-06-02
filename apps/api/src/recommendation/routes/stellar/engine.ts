import { StellarRoute, ScoredRoute, RouteRecommendationOptions } from "./types";
import { scoreRoutes } from "./scorer";

export class StellarRouteRecommendationEngine {
  recommend(
    routes: StellarRoute[],
    options?: RouteRecommendationOptions,
  ): ScoredRoute[] {
    if (!routes.length) return [];

    const scored = scoreRoutes(routes, options);

    return scored.sort((a, b) => b.score - a.score);
  }

  getBestRoute(
    routes: StellarRoute[],
    options?: RouteRecommendationOptions,
  ): ScoredRoute | null {
    const ranked = this.recommend(routes, options);
    return ranked[0] || null;
  }
}
