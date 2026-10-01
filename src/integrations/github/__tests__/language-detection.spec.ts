/**
 * Unit tests for Language Detection
 */

import { LanguageDetector } from '../language-detection';
import { GitHubClient } from '../github-client';
import { GitHubRepository } from '../types';

describe('LanguageDetector', () => {
  let detector: LanguageDetector;
  let mockClient: jest.Mocked<GitHubClient>;
  let repository: GitHubRepository;

  beforeEach(() => {
    repository = {
      owner: 'test-owner',
      repo: 'test-repo',
      isPrivate: false,
      defaultBranch: 'main',
    };

    mockClient = {
      getLanguages: jest.fn(),
      getContents: jest.fn(),
      getRepository: jest.fn(),
    } as any;

    detector = new LanguageDetector(mockClient, repository);
  });

  describe('detectLanguages', () => {
    it('should detect languages from GitHub API', async () => {
      mockClient.getLanguages.mockResolvedValue({
        TypeScript: 100000,
        JavaScript: 50000,
        Rust: 30000,
      });

      const analysis = await detector.detectLanguages();
      
      expect(analysis.primaryLanguage).toBe('TypeScript');
      expect(analysis.languages).toHaveLength(3);
      expect(analysis.totalBytes).toBe(180000);
      expect(analysis.languages[0].language).toBe('TypeScript');
      expect(analysis.languages[0].percentage).toBeCloseTo(55.56, 1);
    });

    it('should handle empty language data', async () => {
      mockClient.getLanguages.mockResolvedValue({});

      const analysis = await detector.detectLanguages();
      
      expect(analysis.primaryLanguage).toBe('Unknown');
      expect(analysis.languages).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getLanguages.mockRejectedValue(new Error('API error'));

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const analysis = await detector.detectLanguages();
      
      expect(analysis.primaryLanguage).toBe('Unknown');
      expect(analysis.languages).toHaveLength(0);

      consoleSpy.mockRestore();
    });
  });

  describe('detectLanguageFromFile', () => {
    it('should detect TypeScript from .ts extension', () => {
      const language = detector.detectLanguageFromFile('index.ts');
      expect(language).toBe('TypeScript');
    });

    it('should detect Rust from .rs extension', () => {
      const language = detector.detectLanguageFromFile('module.rs');
      expect(language).toBe('Rust');
    });

    it('should detect Solidity from .sol extension', () => {
      const language = detector.detectLanguageFromFile('Contract.sol');
      expect(language).toBe('Solidity');
    });

    it('should return Unknown for unrecognized extension', () => {
      const language = detector.detectLanguageFromFile('file.xyz');
      expect(language).toBe('Unknown');
    });
  });

  describe('isSmartContractProject', () => {
    it('should detect Solidity project', async () => {
      mockClient.getLanguages.mockResolvedValue({
        Solidity: 100000,
        JavaScript: 20000,
      });

      const isSmartContract = await detector.isSmartContractProject();
      expect(isSmartContract).toBe(true);
    });

    it('should detect Rust (Soroban) project', async () => {
      mockClient.getLanguages.mockResolvedValue({
        Rust: 100000,
        TypeScript: 30000,
      });

      const isSmartContract = await detector.isSmartContractProject();
      expect(isSmartContract).toBe(true);
    });

    it('should not detect non-smart-contract project', async () => {
      mockClient.getLanguages.mockResolvedValue({
        TypeScript: 100000,
        JavaScript: 50000,
      });

      const isSmartContract = await detector.isSmartContractProject();
      expect(isSmartContract).toBe(false);
    });
  });

  describe('isWebProject', () => {
    it('should detect web project with TypeScript', async () => {
      mockClient.getLanguages.mockResolvedValue({
        TypeScript: 100000,
        HTML: 20000,
        CSS: 10000,
      });

      const isWeb = await detector.isWebProject();
      expect(isWeb).toBe(true);
    });

    it('should detect web project with JavaScript', async () => {
      mockClient.getLanguages.mockResolvedValue({
        JavaScript: 100000,
        HTML: 20000,
      });

      const isWeb = await detector.isWebProject();
      expect(isWeb).toBe(true);
    });

    it('should not detect non-web project', async () => {
      mockClient.getLanguages.mockResolvedValue({
        Rust: 100000,
        Python: 50000,
      });

      const isWeb = await detector.isWebProject();
      expect(isWeb).toBe(false);
    });
  });

  describe('getFileLanguageBreakdown', () => {
    it('should get language breakdown for directory', async () => {
      mockClient.getContents.mockResolvedValue([
        { name: 'index.ts', type: 'file', path: 'src/index.ts', size: 1000 },
        { name: 'utils.ts', type: 'file', path: 'src/utils.ts', size: 2000 },
        { name: 'module.rs', type: 'file', path: 'src/module.rs', size: 1500 },
        { name: 'test.ts', type: 'file', path: 'src/test.ts', size: 500 },
      ]);

      const breakdown = await detector.getFileLanguageBreakdown('src');
      
      expect(breakdown).toHaveLength(4);
      expect(breakdown[0].language).toBe('TypeScript');
      expect(breakdown[2].language).toBe('Rust');
    });

    it('should calculate percentages correctly', async () => {
      mockClient.getContents.mockResolvedValue([
        { name: 'index.ts', type: 'file', path: 'src/index.ts', size: 1000 },
        { name: 'module.rs', type: 'file', path: 'src/module.rs', size: 1000 },
      ]);

      const breakdown = await detector.getFileLanguageBreakdown('src');
      
      expect(breakdown[0].percentage).toBe(50);
      expect(breakdown[1].percentage).toBe(50);
    });

    it('should handle empty directory', async () => {
      mockClient.getContents.mockResolvedValue([]);

      const breakdown = await detector.getFileLanguageBreakdown('src');
      
      expect(breakdown).toHaveLength(0);
    });
  });

  describe('compareDirectories', () => {
    it('should detect language differences between directories', async () => {
      mockClient.getContents
        .mockResolvedValueOnce([
          { name: 'index.ts', type: 'file', path: 'src/index.ts', size: 1000 },
        ])
        .mockResolvedValueOnce([
          { name: 'module.rs', type: 'file', path: 'lib/module.rs', size: 1000 },
        ]);

      const comparison = await detector.compareDirectories('src', 'lib');
      
      expect(comparison.differences.length).toBeGreaterThan(0);
      expect(comparison.dir1.primaryLanguage).toBe('TypeScript');
      expect(comparison.dir2.primaryLanguage).toBe('Rust');
    });

    it('should return no differences for same languages', async () => {
      mockClient.getContents
        .mockResolvedValueOnce([
          { name: 'index.ts', type: 'file', path: 'src/index.ts', size: 1000 },
        ])
        .mockResolvedValueOnce([
          { name: 'utils.ts', type: 'file', path: 'lib/utils.ts', size: 1000 },
        ]);

      const comparison = await detector.compareDirectories('src', 'lib');
      
      expect(comparison.differences).toHaveLength(0);
    });
  });

  describe('formatLanguageAnalysis', () => {
    it('should format language analysis', () => {
      const analysis = {
        primaryLanguage: 'TypeScript',
        languages: [
          { language: 'TypeScript', byteCount: 100000, percentage: 66.7 },
          { language: 'JavaScript', byteCount: 50000, percentage: 33.3 },
        ],
        totalBytes: 150000,
        diversity: 0.92,
        isPolyglot: true,
        recommendedTools: ['eslint', 'prettier', 'typescript'],
      };

      const formatted = detector.formatLanguageAnalysis(analysis);
      
      expect(formatted).toContain('Primary Language: TypeScript');
      expect(formatted).toContain('Diversity Score: 0.92');
      expect(formatted).toContain('Polyglot: Yes');
      expect(formatted).toContain('TypeScript: 66.7%');
      expect(formatted).toContain('Recommended Tools:');
    });
  });
});
