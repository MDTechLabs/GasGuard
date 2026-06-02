export type StellarRoute = {
  id: string;
  path: string[]; // hops between bridges/nodes
  estimatedTimeMs: number;
  estimatedCost: number; // fees or slippage
  reliability?: number; // optional 0-1 score
};

export type ScoredRoute = StellarRoute & {
  score: number;
};

export type RouteRecommendationOptions = {
  weightCost?: number;
  weightSpeed?: number;
  weightReliability?: number;
};
