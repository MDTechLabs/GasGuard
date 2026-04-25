import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { CacheService } from './cache.service';

export interface FileHashInfo {
  filePath: string;
  contentHash: string;
  lastModified: number;
  fileSize: number;
}

export interface HashComparisonResult {
  unchanged: FileHashInfo[];
  modified: FileHashInfo[];
  added: FileHashInfo[];
  deleted: string[];
}

export class FileHashService {
  constructor(private cacheService: CacheService) {}

  /**
   * Generate content-based hash for a file
   */
  async generateFileHash(filePath: string): Promise<FileHashInfo> {
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      
      return {
        filePath: path.normalize(filePath),
        contentHash,
        lastModified: stats.mtime.getTime(),
        fileSize: stats.size,
      };
    } catch (error) {
      throw new Error(`Failed to generate hash for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate hashes for multiple files in parallel
   */
  async generateMultipleFileHashes(filePaths: string[]): Promise<FileHashInfo[]> {
    const hashPromises = filePaths.map(filePath => this.generateFileHash(filePath));
    return Promise.all(hashPromises);
  }

  /**
   * Get cached hash information for a repository
   */
  async getCachedHashes(repoPath: string): Promise<Map<string, FileHashInfo>> {
    const cacheKey = `file-hashes:${this.normalizeRepoPath(repoPath)}`;
    const cached = await this.cacheService.get<Record<string, FileHashInfo>>(cacheKey);
    
    if (!cached) {
      return new Map();
    }
    
    return new Map(Object.entries(cached));
  }

  /**
   * Cache hash information for a repository
   */
  async cacheHashes(repoPath: string, hashes: Map<string, FileHashInfo>): Promise<void> {
    const cacheKey = `file-hashes:${this.normalizeRepoPath(repoPath)}`;
    const hashObject = Object.fromEntries(hashes);
    await this.cacheService.set(cacheKey, hashObject, 86400); // 24 hours TTL
  }

  /**
   * Compare current file hashes with cached hashes
   */
  async compareWithCache(
    repoPath: string,
    currentFiles: string[]
  ): Promise<HashComparisonResult> {
    const cachedHashes = await this.getCachedHashes(repoPath);
    const currentHashes = new Map(
      (await this.generateMultipleFileHashes(currentFiles)).map(info => [info.filePath, info])
    );

    const unchanged: FileHashInfo[] = [];
    const modified: FileHashInfo[] = [];
    const added: FileHashInfo[] = [];
    const deleted: string[] = [];

    // Check for modified and unchanged files
    for (const [filePath, currentInfo] of currentHashes) {
      const cachedInfo = cachedHashes.get(filePath);
      
      if (!cachedInfo) {
        added.push(currentInfo);
      } else if (cachedInfo.contentHash === currentInfo.contentHash) {
        unchanged.push(currentInfo);
      } else {
        modified.push(currentInfo);
      }
    }

    // Check for deleted files
    for (const [filePath] of cachedHashes) {
      if (!currentHashes.has(filePath)) {
        deleted.push(filePath);
      }
    }

    return {
      unchanged,
      modified,
      added,
      deleted,
    };
  }

  /**
   * Find files that depend on modified files (basic implementation)
   */
  async findDependentFiles(
    modifiedFiles: string[],
    allFiles: string[]
  ): Promise<string[]> {
    const dependentFiles: Set<string> = new Set();
    
    for (const modifiedFile of modifiedFiles) {
      // Simple dependency detection based on file extensions and common patterns
      const dependencies = await this.detectDependencies(modifiedFile, allFiles);
      dependencies.forEach(dep => dependentFiles.add(dep));
    }
    
    return Array.from(dependentFiles);
  }

  /**
   * Basic dependency detection between files
   */
  private async detectDependencies(
    sourceFile: string,
    allFiles: string[]
  ): Promise<string[]> {
    const dependencies: string[] = [];
    const sourceExt = path.extname(sourceFile);
    
    try {
      const content = await fs.readFile(sourceFile, 'utf-8');
      const sourceDir = path.dirname(sourceFile);
      
      // Rust dependencies
      if (sourceExt === '.rs') {
        const importMatches = content.match(/use\s+([^;]+);/g) || [];
        for (const importStmt of importMatches) {
          const modulePath = importStmt.replace(/use\s+([^;]+);/, '$1').trim();
          const possibleFiles = this.resolveRustImport(modulePath, sourceDir, allFiles);
          dependencies.push(...possibleFiles);
        }
      }
      
      // Solidity/Vyper dependencies
      if (sourceExt === '.sol' || sourceExt === '.vy') {
        const importMatches = content.match(/import\s+["']([^"']+)["']/g) || [];
        for (const importStmt of importMatches) {
          const importPath = importStmt.match(/import\s+["']([^"']+)["']/)?.[1];
          if (importPath) {
            const possibleFiles = this.resolveSolidityImport(importPath, sourceDir, allFiles);
            dependencies.push(...possibleFiles);
          }
        }
      }
      
    } catch (error) {
      // If we can't read the file, skip dependency detection
    }
    
    return dependencies.filter(dep => allFiles.includes(dep));
  }

  /**
   * Resolve Rust import paths to actual files
   */
  private resolveRustImport(
    modulePath: string,
    sourceDir: string,
    allFiles: string[]
  ): string[] {
    const possibleFiles: string[] = [];
    
    // Handle different Rust import patterns
    if (modulePath.startsWith('crate::')) {
      // Local crate imports
      const relativePath = modulePath.replace('crate::', '').replace(/::/g, '/');
      const possibleFile = path.join(sourceDir, '..', 'src', `${relativePath}.rs`);
      const possibleModDir = path.join(sourceDir, '..', 'src', relativePath, 'mod.rs');
      
      if (allFiles.includes(possibleFile)) {
        possibleFiles.push(possibleFile);
      }
      if (allFiles.includes(possibleModDir)) {
        possibleFiles.push(possibleModDir);
      }
    }
    
    return possibleFiles;
  }

  /**
   * Resolve Solidity import paths to actual files
   */
  private resolveSolidityImport(
    importPath: string,
    sourceDir: string,
    allFiles: string[]
  ): string[] {
    const possibleFiles: string[] = [];
    
    // Relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      const absolutePath = path.resolve(sourceDir, importPath);
      const withExt = allFiles.find(f => f.startsWith(absolutePath));
      if (withExt) {
        possibleFiles.push(withExt);
      }
    }
    
    // Try adding .sol extension if not present
    if (!importPath.endsWith('.sol')) {
      const withSolExt = path.resolve(sourceDir, `${importPath}.sol`);
      if (allFiles.includes(withSolExt)) {
        possibleFiles.push(withSolExt);
      }
    }
    
    return possibleFiles;
  }

  /**
   * Normalize repository path for consistent caching
   */
  private normalizeRepoPath(repoPath: string): string {
    return path.normalize(repoPath).replace(/\\/g, ':').replace(/\//g, ':');
  }

  /**
   * Get supported file extensions for analysis
   */
  getSupportedExtensions(): string[] {
    return ['.rs', '.sol', '.vy'];
  }

  /**
   * Filter files by supported extensions
   */
  filterSupportedFiles(filePaths: string[]): string[] {
    const supportedExts = this.getSupportedExtensions();
    return filePaths.filter(filePath => {
      const ext = path.extname(filePath);
      return supportedExts.includes(ext);
    });
  }
}
