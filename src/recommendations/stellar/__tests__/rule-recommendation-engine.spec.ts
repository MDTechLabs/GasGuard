import { describe, it, expect } from "@jest/globals";
import { SorobanRuleRecommendationEngine } from "../rule-recommendation-engine";

describe("SorobanRuleRecommendationEngine", () => {
  const engine = new SorobanRuleRecommendationEngine();

  it("should recommend check-auth-ordering when require_auth is used", () => {
    const code = `
      pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
          from.require_auth();
      }
    `;
    const res = engine.recommend(code);
    expect(res.detectedTraits).toContain("authorization");
    expect(res.recommendations.some(r => r.id === "check-auth-ordering")).toBe(true);
  });

  it("should recommend storage-caching when storage() is used", () => {
    const code = `
      let val = env.storage().instance().get(&key);
    `;
    const res = engine.recommend(code);
    expect(res.detectedTraits).toContain("instance-storage");
    expect(res.recommendations.some(r => r.id === "storage-caching")).toBe(true);
  });

  it("should recommend loop-storage-avoidance when loops and storage coexist", () => {
    const code = `
      for i in 0..10 {
          let val = env.storage().instance().get(&key);
      }
    `;
    const res = engine.recommend(code);
    expect(res.detectedTraits).toContain("loop-constructs");
    expect(res.recommendations.some(r => r.id === "loop-storage-avoidance")).toBe(true);
  });
});
