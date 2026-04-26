/**
 * Dependency Tracker
 * 
 * Tracks imports and dependencies across files to build a global context
 */

export interface DependencyInfo {
  filePath: string;
  imports: string[];
  exports: string[];
  dependencies: Set<string>;
}

export class DependencyTracker {
  private fileDependencies: Map<string, DependencyInfo> = new Map();
  private reverseDependencies: Map<string, Set<string>> = new Map();

  /**
   * Register a file and its dependencies
   */
  registerFile(filePath: string, imports: string[], exports: string[] = []): void {
    const info: DependencyInfo = {
      filePath,
      imports,
      exports,
      dependencies: new Set(imports),
    };

    this.fileDependencies.set(filePath, info);

    // Update reverse dependencies
    for (const imp of imports) {
      if (!this.reverseDependencies.has(imp)) {
        this.reverseDependencies.set(imp, new Set());
      }
      this.reverseDependencies.get(imp)!.add(filePath);
    }
  }

  /**
   * Get all files that depend on the given file
   */
  getDependents(filePath: string): string[] {
    return Array.from(this.reverseDependencies.get(filePath) || []);
  }

  /**
   * Get all dependencies of a file
   */
  getDependencies(filePath: string): string[] {
    return Array.from(this.fileDependencies.get(filePath)?.dependencies || []);
  }

  /**
   * Build a full dependency graph (BFS/DFS)
   */
  getTransitiveDependencies(filePath: string): string[] {
    const result = new Set<string>();
    const stack = [filePath];
    
    while (stack.length > 0) {
      const current = stack.pop()!;
      const deps = this.getDependencies(current);
      for (const dep of deps) {
        if (!result.has(dep)) {
          result.add(dep);
          stack.push(dep);
        }
      }
    }
    
    return Array.from(result);
  }

  /**
   * Clear all tracked data
   */
  clear(): void {
    this.fileDependencies.clear();
    this.reverseDependencies.clear();
  }
}
