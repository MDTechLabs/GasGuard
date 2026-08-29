import { constantPropagationRule, OptimizationFinding } from '../../../packages/rules/soroban/constants/constant-propagation.rule';

export class RulesService {
  private rules = [constantPropagationRule];

  getRules() {
    return this.rules;
  }

  getRule(id: string) {
    return this.rules.find(rule => rule.id === id);
  }

  analyze(ruleId: string, content: string): OptimizationFinding[] {
    const rule = this.getRule(ruleId);
    if (!rule) return [];
    return rule.analyze(content);
  }

  analyzeAll(content: string): OptimizationFinding[] {
    return this.rules.flatMap(rule => rule.analyze(content));
  }
}
