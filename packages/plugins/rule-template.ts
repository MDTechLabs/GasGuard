export interface RuleMetadata {
  id: string;
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'gas' | 'security' | 'best-practice';
}

export interface RuleMatch {
  line: number;
  column: number;
  message: string;
  suggestion?: string;
}

export abstract class BaseRule {
  abstract metadata: RuleMetadata;

  abstract analyze(code: string): RuleMatch[];

  protected createMatch(line: number, column: number, message: string, suggestion?: string): RuleMatch {
    return { line, column, message, suggestion };
  }
}

export class ExampleStorageRule extends BaseRule {
  metadata: RuleMetadata = {
    id: 'inefficient-storage',
    name: 'Inefficient Storage Pattern',
    description: 'Detects redundant storage operations that increase gas costs',
    severity: 'medium',
    category: 'gas',
  };

  analyze(code: string): RuleMatch[] {
    const matches: RuleMatch[] = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      if (line.includes('storage.set') && line.includes('storage.get')) {
        matches.push(
          this.createMatch(
            index + 1,
            0,
            'Redundant storage operation detected',
            'Cache the value in memory instead of multiple storage reads'
          )
        );
      }
    });

    return matches;
  }
}

export function createRuleTemplate(id: string, name: string): string {
  return `import { BaseRule, RuleMetadata, RuleMatch } from './rule-template';

export class ${name}Rule extends BaseRule {
  metadata: RuleMetadata = {
    id: '${id}',
    name: '${name}',
    description: 'TODO: Add description',
    severity: 'medium',
    category: 'gas',
  };

  analyze(code: string): RuleMatch[] {
    // TODO: Implement analysis logic
    return [];
  }
}`;
}
