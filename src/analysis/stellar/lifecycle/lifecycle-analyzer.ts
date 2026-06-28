/**
 * Soroban Contract Lifecycle Analyzer
 *
 * Detects initialization and upgrade flows in Soroban contracts,
 * flags missing guards, and generates lifecycle reports.
 */

import { InitFlow, LifecycleIssue, LifecycleReport, UpgradeFlow } from './types';

export class StellarLifecycleAnalyzer {
  private source: string;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
  }

  analyze(): LifecycleReport {
    const contractName = this.extractContractName();
    const initFlows = this.extractInitFlows();
    const upgradeFlows = this.extractUpgradeFlows();
    const issues = this.detectIssues(initFlows, upgradeFlows);

    return {
      contractName,
      initFlows,
      upgradeFlows,
      issues,
      summary: this.buildSummary(contractName, initFlows, upgradeFlows, issues),
    };
  }

  private extractContractName(): string {
    const match = this.source.match(/pub struct (\w+)/) || this.source.match(/impl\s+(\w+)/);
    return match ? match[1] : 'UnknownContract';
  }

  private extractInitFlows(): InitFlow[] {
    const flows: InitFlow[] = [];
    const initRegex = /fn\s+(init(?:ialize)?|setup|constructor)\s*\([^)]*\)/g;
    let match;

    while ((match = initRegex.exec(this.source)) !== null) {
      const fnName = match[1];
      const line = this.lineOf(match.index);
      const bodyStart = this.source.indexOf('{', match.index);
      const body = bodyStart !== -1 ? this.extractBlock(bodyStart + 1) : '';

      const hasGuard =
        body.includes('require_auth') ||
        body.includes('panic!') ||
        body.includes('storage().has') ||
        /if\s+.*already/.test(body);

      const storageKeys = [...body.matchAll(/storage\(\)\.\w+\s*\(\s*["']?(\w+)["']?/g)].map(m => m[1]);

      flows.push({ functionName: fnName, hasGuard, storageKeys, line });
    }
    return flows;
  }

  private extractUpgradeFlows(): UpgradeFlow[] {
    const flows: UpgradeFlow[] = [];
    const upgradeRegex = /fn\s+(upgrade|update(?:_wasm)?|migrate)\s*\([^)]*\)/g;
    let match;

    while ((match = upgradeRegex.exec(this.source)) !== null) {
      const fnName = match[1];
      const line = this.lineOf(match.index);
      const bodyStart = this.source.indexOf('{', match.index);
      const body = bodyStart !== -1 ? this.extractBlock(bodyStart + 1) : '';

      const hasAccessControl =
        body.includes('require_auth') ||
        body.includes('assert_admin') ||
        /if\s+.*!=\s*admin/.test(body);

      const isWasm =
        body.includes('update_current_contract_wasm') ||
        body.includes('wasm') ||
        fnName.includes('wasm');

      flows.push({ functionName: fnName, hasAccessControl, isWasm, line });
    }
    return flows;
  }

  private detectIssues(initFlows: InitFlow[], upgradeFlows: UpgradeFlow[]): LifecycleIssue[] {
    const issues: LifecycleIssue[] = [];

    for (const flow of initFlows) {
      if (!flow.hasGuard) {
        issues.push({
          severity: 'high',
          message: `Initialization function '${flow.functionName}' lacks a re-initialization guard`,
          line: flow.line,
        });
      }
    }

    for (const flow of upgradeFlows) {
      if (!flow.hasAccessControl) {
        issues.push({
          severity: 'high',
          message: `Upgrade function '${flow.functionName}' missing access control`,
          line: flow.line,
        });
      }
    }

    if (initFlows.length === 0) {
      issues.push({ severity: 'medium', message: 'No initialization flow detected' });
    }

    return issues;
  }

  private buildSummary(
    contractName: string,
    initFlows: InitFlow[],
    upgradeFlows: UpgradeFlow[],
    issues: LifecycleIssue[],
  ): string {
    const high = issues.filter(i => i.severity === 'high').length;
    return (
      `Contract '${contractName}': ` +
      `${initFlows.length} init flow(s), ` +
      `${upgradeFlows.length} upgrade flow(s), ` +
      `${high} high-severity issue(s).`
    );
  }

  private extractBlock(start: number): string {
    let depth = 1;
    let result = '';
    for (let i = start; i < this.source.length && depth > 0; i++) {
      const ch = this.source[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
      result += ch;
    }
    return result;
  }

  private lineOf(offset: number): number {
    return (this.source.slice(0, offset).match(/\n/g) ?? []).length + 1;
  }
}
