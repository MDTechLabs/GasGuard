import {
  orderRulesForExecution,
  severityRank,
  type OrderableRule,
} from "./rule-execution-order";

describe("orderRulesForExecution", () => {
  const rules: OrderableRule[] = [
    { ruleId: "G020", severity: "low" },
    { ruleId: "G003", severity: "high" },
    { ruleId: "G001", severity: "critical" },
    { ruleId: "G010", severity: "high" },
  ];

  it("orders by severity rank and then by rule id", () => {
    expect(orderRulesForExecution(rules).map((rule) => rule.ruleId)).toEqual([
      "G001",
      "G003",
      "G010",
      "G020",
    ]);
  });

  it("is deterministic for shuffled input", () => {
    const shuffled = [rules[2], rules[0], rules[3], rules[1]];
    expect(orderRulesForExecution(shuffled)).toEqual(
      orderRulesForExecution(rules),
    );
  });

  it("does not mutate the input array", () => {
    const input = [...rules];
    orderRulesForExecution(input);
    expect(input).toEqual(rules);
  });

  it("sorts unknown severities last but keeps rule-id order", () => {
    const withUnknown: OrderableRule[] = [
      { ruleId: "B", severity: "mystery" },
      { ruleId: "A", severity: "mystery" },
      { ruleId: "C", severity: "medium" },
    ];
    expect(orderRulesForExecution(withUnknown).map((rule) => rule.ruleId)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("ranks unknown severities below every known severity", () => {
    expect(severityRank(undefined)).toBeGreaterThan(severityRank("info"));
    expect(severityRank("nonsense")).toBeGreaterThan(severityRank("info"));
  });
});
