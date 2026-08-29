import { EvolutionConfig, EvolutionReport, EvolutionSnapshot, VersionChange } from './types';

export class StellarEvolutionTracker {
  private source: string;
  private filePath: string;
  private config: EvolutionConfig;

  constructor(
    source: string,
    filePath: string,
    config: EvolutionConfig = { trackDependencies: true, alertOnBreakingChanges: true, maxHistoryVersions: 10 },
  ) {
    this.source = source;
    this.filePath = filePath;
    this.config = config;
  }

  track(): EvolutionReport {
    const contractName = this.extractContractName();
    const versions = this.extractVersionChanges();
    const snapshots = this.buildSnapshots(versions);
    const currentComplexity = this.calculateComplexity();
    const complexityTrend = this.determineTrend(snapshots);
    const growthRate = this.calculateGrowthRate(snapshots);
    const recommendations = this.generateRecommendations(versions, currentComplexity, complexityTrend);

    return {
      contractName,
      versions: versions.slice(0, this.config.maxHistoryVersions),
      snapshots,
      currentComplexity,
      complexityTrend,
      growthRate,
      recommendations,
      summary: this.generateSummary(contractName, versions.length, currentComplexity, growthRate),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/)
      || this.source.match(/contract\s+(\w+)/)
      || this.source.match(/#\[contract\]\s*\n.*\b(\w+)\b/);
    return match ? match[1] : 'UnknownContract';
  }

  private extractVersionChanges(): VersionChange[] {
    const changes: VersionChange[] = [];
    const changelogRegex = /##\s+\[?(\d+\.\d+\.\d+)\]?\s*-\s*(\d{4}-\d{2}-\d{2})/g;
    let match;

    while ((match = changelogRegex.exec(this.source)) !== null) {
      const version = match[1];
      const date = match[2];
      const sectionStart = match.index + match[0].length;
      const sectionEnd = this.source.indexOf('\n## ', sectionStart);
      const section = this.source.substring(sectionStart, sectionEnd > 0 ? sectionEnd : this.source.length);

      const changeRegex = /[-*]\s*(?:\*\*)?(\w+)(?:\*\*)?:\s*(.+)/g;
      let changeMatch;
      while ((changeMatch = changeRegex.exec(section)) !== null) {
        const typeStr = changeMatch[1].toLowerCase();
        const changeType = this.normalizeChangeType(typeStr);
        changes.push({
          version,
          date,
          changeType,
          component: this.inferComponent(changeMatch[2]),
          description: changeMatch[2],
          author: 'unknown',
        });
      }
    }

    if (changes.length === 0) {
      changes.push({
        version: '0.1.0',
        date: new Date().toISOString().split('T')[0],
        changeType: 'added',
        component: contractName,
        description: `Initial implementation of ${contractName}`,
        author: 'unknown',
      });
    }

    return changes;
  }

  private normalizeChangeType(type: string): VersionChange['changeType'] {
    if (/add|new|feat|feature/i.test(type)) return 'added';
    if (/modif|change|update|refactor|enhance/i.test(type)) return 'modified';
    if (/deprecat/i.test(type)) return 'deprecated';
    if (/remov|delete|drop|break/i.test(type)) return 'removed';
    return 'modified';
  }

  private inferComponent(description: string): string {
    const fnMatch = description.match(/`(\w+)`/);
    return fnMatch ? fnMatch[1] : 'core';
  }

  private buildSnapshots(versions: VersionChange[]): EvolutionSnapshot[] {
    const snapshots: EvolutionSnapshot[] = [];
    const versionSet = new Set(versions.map(v => v.version));

    for (const version of versionSet) {
      snapshots.push({
        version,
        totalContracts: this.source.split('#[contract]').length - 1 || 1,
        totalFunctions: (this.source.match(/\bfn\s+\w+\s*\(/g) || []).length,
        totalTraits: (this.source.match(/\btrait\s+\w+/g) || []).length,
        complexityScore: this.calculateComplexity(),
        dependencies: this.extractDependencies(),
      });
    }

    return snapshots.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  }

  private calculateComplexity(): number {
    const fnCount = (this.source.match(/\bfn\s+\w+\s*\(/g) || []).length;
    const branchCount = (this.source.match(/\bif\b|\bmatch\b/g) || []).length;
    const loopCount = (this.source.match(/\bfor\b|\bwhile\b|\bloop\b/g) || []).length;
    return fnCount + branchCount + loopCount * 2;
  }

  private extractDependencies(): string[] {
    const deps: string[] = [];
    const useRegex = /use\s+([\w:]+)/g;
    let match;
    while ((match = useRegex.exec(this.source)) !== null) {
      const dep = match[1].split('::')[0];
      if (dep !== 'soroban_sdk' && !deps.includes(dep)) {
        deps.push(dep);
      }
    }
    return this.config.trackDependencies ? deps : [];
  }

  private determineTrend(snapshots: EvolutionSnapshot[]): 'increasing' | 'stable' | 'decreasing' {
    if (snapshots.length < 2) return 'stable';
    const first = snapshots[0].complexityScore;
    const last = snapshots[snapshots.length - 1].complexityScore;
    if (last > first * 1.1) return 'increasing';
    if (last < first * 0.9) return 'decreasing';
    return 'stable';
  }

  private calculateGrowthRate(snapshots: EvolutionSnapshot[]): number {
    if (snapshots.length < 2) return 0;
    const first = snapshots[0].totalFunctions;
    const last = snapshots[snapshots.length - 1].totalFunctions;
    if (first === 0) return last;
    return Math.round(((last - first) / first) * 100);
  }

  private generateRecommendations(
    versions: VersionChange[],
    complexity: number,
    trend: string,
  ): string[] {
    const recs: string[] = [];

    const breakingChanges = versions.filter(v => v.changeType === 'removed');
    if (breakingChanges.length > 0 && this.config.alertOnBreakingChanges) {
      recs.push(`${breakingChanges.length} breaking change(s) detected. Review impact on downstream consumers.`);
    }

    if (complexity > 20) {
      recs.push('Contract complexity is high. Consider refactoring into smaller modules.');
    }

    if (trend === 'increasing') {
      recs.push('Complexity is trending upward. Schedule a refactoring sprint to manage technical debt.');
    }

    if (recs.length === 0) {
      recs.push('Contract evolution looks healthy. Continue monitoring.');
    }

    return recs;
  }

  private generateSummary(contractName: string, versionCount: number, complexity: number, growthRate: number): string {
    return `Contract "${contractName}" has ${versionCount} version(s) tracked. ` +
      `Current complexity score: ${complexity}. Growth rate: ${growthRate}%.`;
  }
}
