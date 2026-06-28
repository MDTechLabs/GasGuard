/**
 * Soroban Contract Inheritance Analyzer
 *
 * Analyzes trait definitions, implementations, and hierarchies in Soroban contracts.
 * Detects deep inheritance that can impact gas usage and auditability.
 */

import { InheritanceAnalysis, InheritanceHierarchy, TraitDefinition, TraitImplementation } from './types';

export class StellarInheritanceAnalyzer {
  private source: string;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
  }

  analyze(): InheritanceAnalysis {
    const contractName = this.extractContractName();
    const traits = this.extractTraitDefinitions();
    const implementations = this.extractImplementations();
    const hierarchies = this.buildHierarchies(traits, implementations);

    const maxDepth = Math.max(0, ...hierarchies.map(h => h.depth));
    const issues = this.identifyIssues(hierarchies);

    return {
      contractName,
      traitsUsed: [...new Set([...traits.map(t => t.name), ...implementations.map(i => i.traitName)])],
      hierarchies,
      maxDepth,
      totalImplementations: implementations.length,
      issues,
      summary: this.generateSummary(hierarchies, maxDepth),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/) || this.source.match(/contract\s+(\w+)/);
    return match ? match[1] : "UnknownContract";
  }

  private extractTraitDefinitions(): TraitDefinition[] {
    const traits: TraitDefinition[] = [];
    const traitRegex = /trait\s+(\w+)(?:\s*:\s*([\w\s,]+))?\s*\{/g;
    let match;

    while ((match = traitRegex.exec(this.source)) !== null) {
      const name = match[1];
      const superTraitsStr = match[2] || '';
      const superTraits = superTraitsStr.split(',').map(s => s.trim()).filter(Boolean);

      const bodyStart = this.source.indexOf('{', match.index) + 1;
      const body = this.extractBlock(this.source, bodyStart);

      traits.push({
        name,
        methods: this.extractMethods(body),
        superTraits,
        line: this.getLineNumber(match.index),
      });
    }
    return traits;
  }

  private extractImplementations(): TraitImplementation[] {
    const impls: TraitImplementation[] = [];
    const implRegex = /impl\s+(?:<[^>]+>\s+)?(\w+)\s+for\s+(\w+)/g;
    let match;

    while ((match = implRegex.exec(this.source)) !== null) {
      impls.push({
        traitName: match[1],
        contractName: match[2],
        methodsImplemented: [],
        line: this.getLineNumber(match.index),
      });
    }
    return impls;
  }

  private buildHierarchies(traits: TraitDefinition[], implementations: TraitImplementation[]): InheritanceHierarchy[] {
    return traits.map(trait => {
      const impls = implementations.filter(i => i.traitName === trait.name);
      const depth = this.calculateDepth(trait, traits);

      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      let recommendation = "Trait usage looks good.";

      if (depth > 3) {
        riskLevel = 'high';
        recommendation = "Deep inheritance detected. Consider using composition to reduce complexity and gas costs.";
      } else if (depth > 2) {
        riskLevel = 'medium';
        recommendation = "Moderate hierarchy depth. Good for now, but monitor during audits.";
      }

      return {
        trait: trait.name,
        depth,
        implementations: impls,
        subTraits: trait.superTraits,
        riskLevel,
        recommendation,
      };
    });
  }

  private calculateDepth(trait: TraitDefinition, allTraits: TraitDefinition[], visited = new Set<string>()): number {
    if (visited.has(trait.name)) return 1; // cycle
    visited.add(trait.name);

    if (trait.superTraits.length === 0) return 1;

    let maxDepth = 1;
    for (const superName of trait.superTraits) {
      const superTrait = allTraits.find(t => t.name === superName);
      if (superTrait) {
        maxDepth = Math.max(maxDepth, 1 + this.calculateDepth(superTrait, allTraits, new Set(visited)));
      }
    }
    return maxDepth;
  }

  private extractMethods(body: string): string[] {
    const methods: string[] = [];
    const methodRegex = /fn\s+(\w+)/g;
    let match;
    while ((match = methodRegex.exec(body)) !== null) {
      methods.push(match[1]);
    }
    return methods;
  }

  private extractBlock(code: string, startIndex: number): string {
    let braceCount = 1;
    let result = "";
    for (let i = startIndex; i < code.length; i++) {
      result += code[i];
      if (code[i] === '{') braceCount++;
      if (code[i] === '}') {
        braceCount--;
        if (braceCount === 0) break;
      }
    }
    return result;
  }

  private getLineNumber(offset: number): number {
    return (this.source.substring(0, offset).match(/\n/g) || []).length + 1;
  }

  private identifyIssues(hierarchies: InheritanceHierarchy[]): string[] {
    return hierarchies
      .filter(h => h.riskLevel === 'high')
      .map(h => `Deep trait hierarchy for ${h.trait} (depth: ${h.depth})`);
  }

  private generateSummary(hierarchies: InheritanceHierarchy[], maxDepth: number): string {
    if (hierarchies.length === 0) return "No traits found in contract.";
    return `Analyzed ${hierarchies.length} trait(s). Max inheritance depth: ${maxDepth}.`;
  }
}