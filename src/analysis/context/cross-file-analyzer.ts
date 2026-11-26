/**
 * Cross-File Analyzer
 *
 * Analyzes interactions across multiple files to detect circular dependencies,
 * unused exports, and redundant imports deterministically.
 */

import { DependencyTracker } from './dependency-tracker';

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface AnalysisIssue {
  type: 'circular-dependency' | 'unused-export' | 'redundant-import' | string;
  message: string;
  files: string[];
  severity: IssueSeverity;
}

export interface CrossFileAnalyzerOptions {
  /** Entry point files whose exports may be public API rather than unused. */
  entryFiles?: string[];
  /** Whether to normalize file paths to POSIX forward slashes. */
  normalizePaths?: boolean;
}

type VisitState = 'unvisited' | 'visiting' | 'visited';

interface TrackerLike {
  getFiles?: () => Iterable<string>;
  getDependencies?: (file: string) => Iterable<string>;
  getImports?: (
    file: string,
  ) => Iterable<{ source: string; specifiers?: string[] }>;
  getExports?: (file: string) => Iterable<string>;
}

export class CrossFileAnalyzer {
  private readonly entryFiles: Set<string>;
  private readonly normalizePaths: boolean;

  constructor(
    private readonly tracker: DependencyTracker,
    options: CrossFileAnalyzerOptions = {},
  ) {
    this.normalizePaths = options.normalizePaths ?? true;
    this.entryFiles = new Set(
      (options.entryFiles ?? []).map((f) => this.normalizePath(f)),
    );
  }

  /**
   * Run cross-file analysis and return deterministic, sorted issues.
   */
  analyze(): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [
      ...this.detectCircularDependencies(),
      ...this.detectUnusedExports(),
      ...this.detectRedundantImports(),
    ];

    return issues.sort((a, b) => {
      const fileA = a.files[0] ?? '';
      const fileB = b.files[0] ?? '';
      if (fileA !== fileB) return fileA.localeCompare(fileB);
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.message.localeCompare(b.message);
    });
  }

  /**
   * Detect dependency cycles across files using three-state DFS.
   */
  private detectCircularDependencies(): AnalysisIssue[] {
    const files = this.getTrackedFiles();
    const adjacency = new Map<string, string[]>();

    for (const file of files) {
      const deps = this.getFileDependencies(file).sort();
      adjacency.set(file, deps);
    }

    const state = new Map<string, VisitState>();
    const activeStack: string[] = [];
    const seenCycles = new Set<string>();
    const issues: AnalysisIssue[] = [];

    const dfs = (current: string): void => {
      state.set(current, 'visiting');
      activeStack.push(current);

      const neighbors = adjacency.get(current) ?? [];
      for (const next of neighbors) {
        const nextState = state.get(next) ?? 'unvisited';

        if (nextState === 'visiting') {
          const cycleStartIndex = activeStack.indexOf(next);
          if (cycleStartIndex !== -1) {
            const cycleNodes = activeStack.slice(cycleStartIndex);
            const canonicalKey = this.canonicalizeCycle(cycleNodes);

            if (!seenCycles.has(canonicalKey)) {
              seenCycles.add(canonicalKey);
              const uniqueFiles = [...new Set(cycleNodes)].sort();
              const chainLabel = [...cycleNodes, next].join(' -> ');

              issues.push({
                type: 'circular-dependency',
                message: `Circular dependency detected: ${chainLabel}`,
                files: uniqueFiles,
                severity: 'high',
              });
            }
          }
        } else if (nextState === 'unvisited') {
          dfs(next);
        }
      }

      activeStack.pop();
      state.set(current, 'visited');
    };

    for (const file of files) {
      if ((state.get(file) ?? 'unvisited') === 'unvisited') {
        dfs(file);
      }
    }

    return issues;
  }

  /**
   * Detect exported symbols that are never imported by any other file.
   */
  private detectUnusedExports(): AnalysisIssue[] {
    const files = this.getTrackedFiles();
    const importedBySource = new Map<string, Set<string>>();
    const allImportedSymbols = new Set<string>();

    for (const file of files) {
      const imports = this.getFileImports(file);
      for (const imp of imports) {
        const resolvedSource = this.normalizePath(imp.source);
        const specs = imp.specifiers ?? [];
        const targetSet = importedBySource.get(resolvedSource) ?? new Set<string>();

        for (const spec of specs) {
          targetSet.add(spec);
          allImportedSymbols.add(spec);
        }

        importedBySource.set(resolvedSource, targetSet);
      }
    }

    const issues: AnalysisIssue[] = [];

    for (const file of files) {
      if (this.entryFiles.has(file)) {
        continue;
      }

      const exportsList = [...new Set(this.getFileExports(file))].sort();
      const directImports = importedBySource.get(file);

      for (const symbol of exportsList) {
        const isUsedInFile = directImports
          ? directImports.has(symbol) || directImports.has('*')
          : allImportedSymbols.has(symbol);

        if (!isUsedInFile) {
          issues.push({
            type: 'unused-export',
            message: `Exported symbol "${symbol}" in "${file}" is not imported by other files.`,
            files: [file],
            severity: 'low',
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detect repeated or redundant imports from the same source within a file.
   */
  private detectRedundantImports(): AnalysisIssue[] {
    const files = this.getTrackedFiles();
    const issues: AnalysisIssue[] = [];

    for (const file of files) {
      const imports = this.getFileImports(file);
      const countsBySource = new Map<string, number>();
      const seenSpecifiersBySource = new Map<string, Set<string>>();

      for (const imp of imports) {
        const source = this.normalizePath(imp.source);
        countsBySource.set(source, (countsBySource.get(source) ?? 0) + 1);

        const specs = imp.specifiers ?? [];
        const seenSpecs = seenSpecifiersBySource.get(source) ?? new Set<string>();

        for (const spec of specs) {
          if (seenSpecs.has(spec)) {
            issues.push({
              type: 'redundant-import',
              message: `Duplicate specifier "${spec}" imported from "${source}" in "${file}".`,
              files: [file],
              severity: 'low',
            });
          } else {
            seenSpecs.add(spec);
          }
        }

        seenSpecifiersBySource.set(source, seenSpecs);
      }

      for (const [source, count] of countsBySource.entries()) {
        if (count > 1) {
          issues.push({
            type: 'redundant-import',
            message: `Multiple import statements (${count}) reference "${source}" in "${file}". Consider consolidating them.`,
            files: [file],
            severity: 'medium',
          });
        }
      }
    }

    return issues;
  }

  private canonicalizeCycle(cycleNodes: string[]): string {
    if (cycleNodes.length === 0) return '';
    const rotations: string[] = [];
    for (let i = 0; i < cycleNodes.length; i++) {
      const rotated = [
        ...cycleNodes.slice(i),
        ...cycleNodes.slice(0, i),
      ].join(' -> ');
      rotations.push(rotated);
    }
    return rotations.sort()[0];
  }

  private normalizePath(filePath: string): string {
    return this.normalizePaths ? filePath.replace(/\\/g, '/') : filePath;
  }

  private getTrackerView(): TrackerLike {
    return this.tracker as unknown as TrackerLike;
  }

  private getTrackedFiles(): string[] {
    const view = this.getTrackerView();
    if (typeof view.getFiles === 'function') {
      return [...new Set([...view.getFiles()].map((f) => this.normalizePath(f)))].sort();
    }
    return [];
  }

  private getFileDependencies(file: string): string[] {
    const view = this.getTrackerView();
    if (typeof view.getDependencies === 'function') {
      return [...new Set([...view.getDependencies(file)].map((f) => this.normalizePath(f)))];
    }
    if (typeof view.getImports === 'function') {
      return [...new Set([...view.getImports(file)].map((imp) => this.normalizePath(imp.source)))];
    }
    return [];
  }

  private getFileImports(
    file: string,
  ): Array<{ source: string; specifiers?: string[] }> {
    const view = this.getTrackerView();
    if (typeof view.getImports === 'function') {
      return [...view.getImports(file)];
    }
    return [];
  }

  private getFileExports(file: string): string[] {
    const view = this.getTrackerView();
    if (typeof view.getExports === 'function') {
      return [...view.getExports(file)];
    }
    return [];
  }
}