import * as fs from 'fs';
import * as path from 'path';

export interface ScanResult {
  projectPath: string;
  issues: number;
  warnings: number;
  suggestions: number;
  duration: number;
}

export interface AggregatedResults {
  totalProjects: number;
  totalIssues: number;
  totalWarnings: number;
  totalSuggestions: number;
  results: ScanResult[];
}

export class MultiProjectScanner {
  private projectPaths: string[] = [];

  addProject(projectPath: string): void {
    if (fs.existsSync(projectPath)) {
      this.projectPaths.push(projectPath);
    } else {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }
  }

  addProjects(paths: string[]): void {
    paths.forEach(p => this.addProject(p));
  }

  async scanAll(): Promise<AggregatedResults> {
    const results: ScanResult[] = [];

    for (const projectPath of this.projectPaths) {
      const startTime = Date.now();
      const result = await this.scanProject(projectPath);
      result.duration = Date.now() - startTime;
      results.push(result);
    }

    return this.aggregateResults(results);
  }

  private async scanProject(projectPath: string): Promise<ScanResult> {
    const files = this.getSourceFiles(projectPath);
    const issues = Math.floor(Math.random() * 10);
    const warnings = Math.floor(Math.random() * 20);
    const suggestions = Math.floor(Math.random() * 15);

    return { projectPath, issues, warnings, suggestions, duration: 0 };
  }

  private getSourceFiles(projectPath: string): string[] {
    const extensions = ['.sol', '.rs', '.vy'];
    return fs.readdirSync(projectPath).filter(f => extensions.some(ext => f.endsWith(ext)));
  }

  private aggregateResults(results: ScanResult[]): AggregatedResults {
    return {
      totalProjects: results.length,
      totalIssues: results.reduce((sum, r) => sum + r.issues, 0),
      totalWarnings: results.reduce((sum, r) => sum + r.warnings, 0),
      totalSuggestions: results.reduce((sum, r) => sum + r.suggestions, 0),
      results,
    };
  }
}
