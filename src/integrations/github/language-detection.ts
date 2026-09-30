/**
 * Repository Language Detection
 * 
 * Detects and analyzes the programming languages used in a repository,
 * providing detailed statistics and insights for tooling and analysis decisions.
 * Implements #1046
 */

import { GitHubClient } from './github-client';
import { RepositoryLanguage, GitHubRepository } from './types';

export interface LanguageAnalysis {
  primaryLanguage: string;
  languages: RepositoryLanguage[];
  totalBytes: number;
  diversity: number;
  isPolyglot: boolean;
  recommendedTools: string[];
}

export interface FileLanguageBreakdown {
  path: string;
  language: string;
  bytes: number;
  percentage: number;
}

export class LanguageDetector {
  private client: GitHubClient;
  private repository: GitHubRepository;

  // Mapping of file extensions to languages
  private static readonly EXTENSION_MAP: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.mjs': 'JavaScript',
    '.cjs': 'JavaScript',
    '.rs': 'Rust',
    '.go': 'Go',
    '.py': 'Python',
    '.sol': 'Solidity',
    '.vy': 'Vyper',
    '.java': 'Java',
    '.kt': 'Kotlin',
    '.scala': 'Scala',
    '.cpp': 'C++',
    '.cc': 'C++',
    '.cxx': 'C++',
    '.hpp': 'C++',
    '.h': 'C',
    '.c': 'C',
    '.cs': 'C#',
    '.php': 'PHP',
    '.rb': 'Ruby',
    '.swift': 'Swift',
    '.obj': 'Objective-C',
    '.m': 'Objective-C',
    '.dart': 'Dart',
    '.lua': 'Lua',
    '.r': 'R',
    '.sql': 'SQL',
    '.sh': 'Shell',
    '.bash': 'Shell',
    '.zsh': 'Shell',
    '.ps1': 'PowerShell',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.sass': 'Sass',
    '.less': 'Less',
    '.json': 'JSON',
    '.xml': 'XML',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.toml': 'TOML',
    '.md': 'Markdown',
    '.rst': 'reStructuredText',
    '.tex': 'TeX',
  };

  // Languages commonly used in smart contract development
  private static readonly SMART_CONTRACT_LANGUAGES = [
    'Solidity',
    'Vyper',
    'Rust',
    'Assembly',
  ];

  // Languages commonly used in web development
  private static readonly WEB_LANGUAGES = [
    'TypeScript',
    'JavaScript',
    'HTML',
    'CSS',
  ];

  constructor(client: GitHubClient, repository: GitHubRepository) {
    this.client = client;
    this.repository = repository;
  }

  /**
   * Detect languages using GitHub's language API
   */
  async detectLanguages(): Promise<LanguageAnalysis> {
    try {
      const languages = await this.client.getLanguages(
        this.repository.owner,
        this.repository.repo
      );

      return this.analyzeLanguages(languages);
    } catch (error) {
      console.error('Failed to detect languages:', error);
      return this.getEmptyAnalysis();
    }
  }

  /**
   * Analyze language data
   */
  private analyzeLanguages(languages: Record<string, number>): LanguageAnalysis {
    const totalBytes = Object.values(languages).reduce((sum, bytes) => sum + bytes, 0);

    const languageArray: RepositoryLanguage[] = Object.entries(languages).map(
      ([language, byteCount]) => ({
        language,
        byteCount,
        percentage: totalBytes > 0 ? (byteCount / totalBytes) * 100 : 0,
      })
    );

    // Sort by percentage descending
    languageArray.sort((a, b) => b.percentage - a.percentage);

    const primaryLanguage = languageArray[0]?.language || 'Unknown';
    const diversity = this.calculateDiversity(languageArray);
    const isPolyglot = languageArray.length > 2 && diversity > 0.3;

    const recommendedTools = this.recommendTools(languageArray);

    return {
      primaryLanguage,
      languages: languageArray,
      totalBytes,
      diversity,
      isPolyglot,
      recommendedTools,
    };
  }

  /**
   * Calculate language diversity (Shannon entropy approximation)
   */
  private calculateDiversity(languages: RepositoryLanguage[]): number {
    if (languages.length === 0) return 0;

    let entropy = 0;
    for (const lang of languages) {
      const p = lang.percentage / 100;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }

    // Normalize by maximum possible entropy
    const maxEntropy = Math.log2(languages.length);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }

  /**
   * Recommend tools based on detected languages
   */
  private recommendTools(languages: RepositoryLanguage[]): string[] {
    const tools: Set<string> = new Set();
    const languageNames = languages.map(l => l.language);

    // Smart contract tools
    if (languageNames.some(l => LanguageDetector.SMART_CONTRACT_LANGUAGES.includes(l))) {
      tools.add('solidity-compiler');
      tools.add('hardhat');
      tools.add('gasguard');
      
      if (languageNames.includes('Rust')) {
        tools.add('cargo');
        tools.add('soroban-cli');
      }
    }

    // Web development tools
    if (languageNames.some(l => LanguageDetector.WEB_LANGUAGES.includes(l))) {
      tools.add('eslint');
      tools.add('prettier');
      tools.add('typescript');
      
      if (languageNames.includes('TypeScript')) {
        tools.add('ts-node');
        tools.add('ts-jest');
      }
    }

    // General tools
    if (languageNames.includes('Python')) {
      tools.add('pytest');
      tools.add('black');
      tools.add('mypy');
    }

    if (languageNames.includes('Rust')) {
      tools.add('clippy');
      tools.add('rustfmt');
    }

    if (languageNames.includes('Go')) {
      tools.add('gofmt');
      tools.add('go-test');
    }

    return Array.from(tools);
  }

  /**
   * Get detailed file-level language breakdown
   */
  async getFileLanguageBreakdown(path: string = ''): Promise<FileLanguageBreakdown[]> {
    try {
      const contents = await this.client.getContents(
        this.repository.owner,
        this.repository.repo,
        path
      );

      if (!Array.isArray(contents)) {
        return [];
      }

      const breakdown: FileLanguageBreakdown[] = [];

      for (const item of contents) {
        if (item.type === 'file') {
          const language = this.detectLanguageFromFile(item.name);
          if (language && language !== 'Unknown') {
            breakdown.push({
              path: item.path,
              language,
              bytes: item.size || 0,
              percentage: 0, // Will be calculated after total is known
            });
          }
        }
      }

      // Calculate percentages
      const totalBytes = breakdown.reduce((sum, f) => sum + f.bytes, 0);
      breakdown.forEach(f => {
        f.percentage = totalBytes > 0 ? (f.bytes / totalBytes) * 100 : 0;
      });

      return breakdown;
    } catch (error) {
      console.error('Failed to get file language breakdown:', error);
      return [];
    }
  }

  /**
   * Detect language from file name/extension
   */
  detectLanguageFromFile(filename: string): string {
    const ext = filename.substring(filename.lastIndexOf('.'));
    return LanguageDetector.EXTENSION_MAP[ext] || 'Unknown';
  }

  /**
   * Check if repository is a smart contract project
   */
  async isSmartContractProject(): Promise<boolean> {
    const analysis = await this.detectLanguages();
    const languageNames = analysis.languages.map(l => l.language);
    
    return languageNames.some(l =>
      LanguageDetector.SMART_CONTRACT_LANGUAGES.includes(l)
    );
  }

  /**
   * Check if repository is a web project
   */
  async isWebProject(): Promise<boolean> {
    const analysis = await this.detectLanguages();
    const languageNames = analysis.languages.map(l => l.language);
    
    return languageNames.some(l => LanguageDetector.WEB_LANGUAGES.includes(l));
  }

  /**
   * Get language statistics for a specific directory
   */
  async getDirectoryLanguageStats(directory: string): Promise<LanguageAnalysis> {
    try {
      const breakdown = await this.getFileLanguageBreakdown(directory);
      
      const languages: Record<string, number> = {};
      let totalBytes = 0;

      for (const file of breakdown) {
        languages[file.language] = (languages[file.language] || 0) + file.bytes;
        totalBytes += file.bytes;
      }

      return this.analyzeLanguages(languages);
    } catch (error) {
      console.error(`Failed to get language stats for ${directory}:`, error);
      return this.getEmptyAnalysis();
    }
  }

  /**
   * Compare language usage between two directories
   */
  async compareDirectories(dir1: string, dir2: string): Promise<{
    dir1: LanguageAnalysis;
    dir2: LanguageAnalysis;
    differences: string[];
  }> {
    const [stats1, stats2] = await Promise.all([
      this.getDirectoryLanguageStats(dir1),
      this.getDirectoryLanguageStats(dir2),
    ]);

    const differences: string[] = [];

    if (stats1.primaryLanguage !== stats2.primaryLanguage) {
      differences.push(
        `Primary language differs: ${dir1}=${stats1.primaryLanguage}, ${dir2}=${stats2.primaryLanguage}`
      );
    }

    const langSet1 = new Set(stats1.languages.map(l => l.language));
    const langSet2 = new Set(stats2.languages.map(l => l.language));

    const onlyInDir1 = [...langSet1].filter(l => !langSet2.has(l));
    const onlyInDir2 = [...langSet2].filter(l => !langSet1.has(l));

    if (onlyInDir1.length > 0) {
      differences.push(`Languages only in ${dir1}: ${onlyInDir1.join(', ')}`);
    }

    if (onlyInDir2.length > 0) {
      differences.push(`Languages only in ${dir2}: ${onlyInDir2.join(', ')}`);
    }

    return {
      dir1: stats1,
      dir2: stats2,
      differences,
    };
  }

  /**
   * Get empty analysis for error cases
   */
  private getEmptyAnalysis(): LanguageAnalysis {
    return {
      primaryLanguage: 'Unknown',
      languages: [],
      totalBytes: 0,
      diversity: 0,
      isPolyglot: false,
      recommendedTools: [],
    };
  }

  /**
   * Format language analysis as human-readable string
   */
  formatLanguageAnalysis(analysis: LanguageAnalysis): string {
    const lines: string[] = [];

    lines.push('=== Repository Language Analysis ===');
    lines.push(`Primary Language: ${analysis.primaryLanguage}`);
    lines.push(`Total Bytes: ${analysis.totalBytes.toLocaleString()}`);
    lines.push(`Diversity Score: ${analysis.diversity.toFixed(2)}`);
    lines.push(`Polyglot: ${analysis.isPolyglot ? 'Yes' : 'No'}`);
    lines.push('');

    if (analysis.languages.length > 0) {
      lines.push('Languages:');
      analysis.languages.forEach(lang => {
        lines.push(`  ${lang.language}: ${lang.percentage.toFixed(1)}% (${lang.byteCount.toLocaleString()} bytes)`);
      });
      lines.push('');
    }

    if (analysis.recommendedTools.length > 0) {
      lines.push('Recommended Tools:');
      analysis.recommendedTools.forEach(tool => lines.push(`  - ${tool}`));
    }

    return lines.join('\n');
  }
}
