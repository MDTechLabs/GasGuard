export interface RpcEndpoint {
  url: string;
  weight: number;
  priority: number;
}

export class FailoverStrategy {
  private endpoints: RpcEndpoint[];

  constructor(endpoints: RpcEndpoint[]) {
    this.endpoints = endpoints.sort((a, b) => b.priority - a.priority || b.weight - a.weight);
  }

  getBestEndpoint(healthyUrls: Set<string>): RpcEndpoint | null {
    const candidates = this.endpoints.filter(e => healthyUrls.has(e.url));
    if (candidates.length === 0) return null;

    // Weighted random selection among top priority healthy endpoints
    const topPriority = candidates[0].priority;
    const topCandidates = candidates.filter(e => e.priority === topPriority);

    const totalWeight = topCandidates.reduce((sum, e) => sum + e.weight, 0);
    let random = Math.random() * totalWeight;

    for (const endpoint of topCandidates) {
      if (random < endpoint.weight) return endpoint;
      random -= endpoint.weight;
    }

    return topCandidates[0];
  }
}
