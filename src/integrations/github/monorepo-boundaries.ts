/**
 * Monorepo Package Boundaries Detection
 * 
 * Detects and analyzes package boundaries in monorepo structures
 * to understand dependencies and enforce clean architecture principles.
 * Implements #1045
 */

import { GitHubClient } from './github-client';
import { MonorepoPackageBoundary } from './types';

export interface MonorepoConfig {
  rootPackageFiles: string[];
  packageIndicatorFiles: {
    npm: string[];
    rust: string[];
    go: string[];
    python: string[];
  };
  ignorePatterns: string[];
}

const DEFAULT_CONFIG: MonorepoConfig = {
  rootPackageFiles: ['package.json', 'pnpm-workspace.yaml', 'lerna.json', 'turbo.json'],
  packageIndicatorFiles: {
    npm: ['package.json', 'tsconfig.json'],
    rust: ['Cargo.toml', 'Cargo.lock'],
    go: ['go.mod', 'go.sum'],
    python: ['pyproject.toml', 'setup.py', 'requirements.txt'],
  },
  ignorePatterns: ['node_modules', 'target', '.git', 'dist', 'build', 'coverage'],
};

export class MonorepoBoundaryDetector {
  private client: GitHubClient;
  private config: MonorepoConfig;

  constructor(client: GitHubClient, config: Partial<MonorepoConfig> = {}) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect if repository is a monorepo
   */
  async isMonorepo(owner: string, repo: string): Promise<boolean> {
    try {
      const rootContents = await this.client.getContents(owner, repo, '');
      
      if (!Array.isArray(rootContents)) {
        return false;
      }

      const hasWorkspaceConfig = rootContents.some(file =>
        this.config.rootPackageFiles.includes(file.name)
      );

      if (hasWorkspaceConfig) {
        return true;
      }

      // Check for nested package structures
      const nestedPackages = await this.detectNestedPackages(owner, repo, rootContents);
      return nestedPackages.length > 1;
    } catch (error) {
      console.error('Failed to detect monorepo:', error);
      return false;
    }
  }

  /**
   * Detect all package boundaries in the repository
   */
  async detectPackageBoundaries(
    owner: string,
    repo: string
  ): Promise<MonorepoPackageBoundary[]> {
    const boundaries: MonorepoPackageBoundary[] = [];

    try {
      const rootContents = await this.client.getContents(owner, repo, '');
      
      if (!Array.isArray(rootContents)) {
        return boundaries;
      }

      // Process each directory in root
      for (const item of rootContents) {
        if (item.type === 'dir' && !this.shouldIgnore(item.name)) {
          const boundary = await this.analyzePackage(owner, repo, item.name);
          if (boundary) {
            boundaries.push(boundary);
          }
        }
      }

      // Also check root as a package
      const rootBoundary = await this.analyzePackage(owner, repo, '');
      if (rootBoundary) {
        boundaries.unshift(rootBoundary);
      }
    } catch (error) {
      console.error('Failed to detect package boundaries:', error);
    }

    return boundaries;
  }

  /**
   * Analyze a specific path to determine if it's a package
   */
  private async analyzePackage(
    owner: string,
    repo: string,
    path: string
  ): Promise<MonorepoPackageBoundary | null> {
    try {
      const contents = await this.client.getContents(owner, repo, path);
      
      if (!Array.isArray(contents)) {
        return null;
      }

      const files = contents.map(f => f.name);
      const boundary: MonorepoPackageBoundary = {
        packageName: path || 'root',
        path,
        languages: [],
        dependencies: [],
        hasPackageJson: files.includes('package.json'),
        hasCargoToml: files.includes('Cargo.toml'),
        hasGoMod: files.includes('go.mod'),
        hasPyProject: files.includes('pyproject.toml'),
      };

      // Detect languages from file extensions
      boundary.languages = this.detectLanguages(contents);

      // Extract dependencies based on package type
      if (boundary.hasPackageJson) {
        boundary.dependencies = await this.extractNpmDependencies(owner, repo, path);
      } else if (boundary.hasCargoToml) {
        boundary.dependencies = await this.extractRustDependencies(owner, repo, path);
      } else if (boundary.hasGoMod) {
        boundary.dependencies = await this.extractGoDependencies(owner, repo, path);
      }

      // Only return if it has some package indicators
      const hasPackageIndicators =
        boundary.hasPackageJson ||
        boundary.hasCargoToml ||
        boundary.hasGoMod ||
        boundary.hasPyProject ||
        boundary.languages.length > 0;

      return hasPackageIndicators ? boundary : null;
    } catch (error) {
      console.error(`Failed to analyze package at ${path}:`, error);
      return null;
    }
  }

  /**
   * Detect languages from file list
   */
  private detectLanguages(contents: any[]): string[] {
    const languageMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.rs': 'Rust',
      '.go': 'Go',
      '.py': 'Python',
      '.sol': 'Solidity',
      '.vy': 'Vyper',
    };

    const languages = new Set<string>();
    
    for (const item of contents) {
      if (item.type === 'file') {
        const ext = item.name.substring(item.name.lastIndexOf('.'));
        if (languageMap[ext]) {
          languages.add(languageMap[ext]);
        }
      }
    }

    return Array.from(languages);
  }

  /**
   * Extract npm dependencies from package.json
   */
  private async extractNpmDependencies(
    owner: string,
    repo: string,
    path: string
  ): Promise<string[]> {
    try {
      const packageJsonPath = path ? `${path}/package.json` : 'package.json';
      const content = await this.client.getContents(owner, repo, packageJsonPath);
      
      if (content.type === 'file' && content.content) {
        const decoded = Buffer.from(content.content, 'base64').toString('utf-8');
        const pkg = JSON.parse(decoded);
        
        const deps = [
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.devDependencies || {}),
        ];
        
        return deps;
      }
    } catch (error) {
      console.error('Failed to extract npm dependencies:', error);
    }
    return [];
  }

  /**
   * Extract Rust dependencies from Cargo.toml
   */
  private async extractRustDependencies(
    owner: string,
    repo: string,
    path: string
  ): Promise<string[]> {
    try {
      const cargoPath = path ? `${path}/Cargo.toml` : 'Cargo.toml';
      const content = await this.client.getContents(owner, repo, cargoPath);
      
      if (content.type === 'file' && content.content) {
        const decoded = Buffer.from(content.content, 'base64').toString('utf-8');
        const deps: string[] = [];
        
        // Simple parsing for dependencies section
        const lines = decoded.split('\n');
        let inDeps = false;
        
        for (const line of lines) {
          if (line.trim().startsWith('[dependencies]')) {
            inDeps = true;
          } else if (line.trim().startsWith('[') && inDeps) {
            inDeps = false;
          } else if (inDeps && line.includes('=')) {
            const dep = line.split('=')[0].trim();
            deps.push(dep);
          }
        }
        
        return deps;
      }
    } catch (error) {
      console.error('Failed to extract Rust dependencies:', error);
    }
    return [];
  }

  /**
   * Extract Go dependencies from go.mod
   */
  private async extractGoDependencies(
    owner: string,
    repo: string,
    path: string
  ): Promise<string[]> {
    try {
      const goModPath = path ? `${path}/go.mod` : 'go.mod';
      const content = await this.client.getContents(owner, repo, goModPath);
      
      if (content.type === 'file' && content.content) {
        const decoded = Buffer.from(content.content, 'base64').toString('utf-8');
        const deps: string[] = [];
        
        const lines = decoded.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('require ')) {
            const dep = line.split(' ')[1];
            if (dep) {
              deps.push(dep);
            }
          }
        }
        
        return deps;
      }
    } catch (error) {
      console.error('Failed to extract Go dependencies:', error);
    }
    return [];
  }

  /**
   * Detect nested packages in a directory
   */
  private async detectNestedPackages(
    owner: string,
    repo: string,
    contents: any[]
  ): Promise<string[]> {
    const packages: string[] = [];

    for (const item of contents) {
      if (item.type === 'dir' && !this.shouldIgnore(item.name)) {
        try {
          const dirContents = await this.client.getContents(owner, repo, item.name);
          if (Array.isArray(dirContents)) {
            const hasPackage = dirContents.some(f =>
              ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'].includes(f.name)
            );
            if (hasPackage) {
              packages.push(item.name);
            }
          }
        } catch (error) {
          // Skip directories we can't access
        }
      }
    }

    return packages;
  }

  /**
   * Check if a path should be ignored
   */
  private shouldIgnore(path: string): boolean {
    return this.config.ignorePatterns.some(pattern =>
      path.includes(pattern)
    );
  }

  /**
   * Validate package boundaries (check for circular dependencies, etc.)
   */
  async validateBoundaries(
    boundaries: MonorepoPackageBoundary[]
  ): Promise<{ valid: boolean; violations: string[] }> {
    const violations: string[] = [];
    const packageMap = new Map(boundaries.map(b => [b.packageName, b]));

    // Check for self-dependencies
    for (const boundary of boundaries) {
      if (boundary.dependencies.includes(boundary.packageName)) {
        violations.push(
          `Package ${boundary.packageName} has self-dependency`
        );
      }
    }

    // Check for circular dependencies (simplified check)
    for (const boundary of boundaries) {
      for (const dep of boundary.dependencies) {
        const depPackage = packageMap.get(dep);
        if (depPackage && depPackage.dependencies.includes(boundary.packageName)) {
          violations.push(
            `Circular dependency detected between ${boundary.packageName} and ${dep}`
          );
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
