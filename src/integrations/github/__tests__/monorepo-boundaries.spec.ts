/**
 * Unit tests for Monorepo Boundary Detector
 */

import { MonorepoBoundaryDetector } from '../monorepo-boundaries';
import { GitHubClient } from '../github-client';
import { MonorepoPackageBoundary } from '../types';

describe('MonorepoBoundaryDetector', () => {
  let detector: MonorepoBoundaryDetector;
  let mockClient: jest.Mocked<GitHubClient>;

  beforeEach(() => {
    mockClient = {
      getContents: jest.fn(),
      getRepository: jest.fn(),
    } as any;

    detector = new MonorepoBoundaryDetector(mockClient);
  });

  describe('isMonorepo', () => {
    it('should detect monorepo with workspace config', async () => {
      mockClient.getContents.mockResolvedValue([
        { name: 'package.json', type: 'file' },
        { name: 'pnpm-workspace.yaml', type: 'file' },
        { name: 'apps', type: 'dir' },
        { name: 'packages', type: 'dir' },
      ]);

      const result = await detector.isMonorepo('owner', 'repo');
      expect(result).toBe(true);
    });

    it('should detect monorepo with nested packages', async () => {
      mockClient.getContents
        .mockResolvedValueOnce([
          { name: 'apps', type: 'dir' },
          { name: 'packages', type: 'dir' },
        ])
        .mockResolvedValueOnce([
          { name: 'package.json', type: 'file' },
        ])
        .mockResolvedValueOnce([
          { name: 'package.json', type: 'file' },
        ]);

      const result = await detector.isMonorepo('owner', 'repo');
      expect(result).toBe(true);
    });

    it('should return false for single package repo', async () => {
      mockClient.getContents.mockResolvedValue([
        { name: 'package.json', type: 'file' },
        { name: 'src', type: 'dir' },
      ]);

      // Mock the nested package check to return empty
      mockClient.getContents.mockResolvedValue([]);

      const result = await detector.isMonorepo('owner', 'repo');
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockClient.getContents.mockRejectedValue(new Error('API error'));

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await detector.isMonorepo('owner', 'repo');
      expect(result).toBe(false);

      consoleSpy.mockRestore();
    });
  });

  describe('detectPackageBoundaries', () => {
    it('should detect package boundaries', async () => {
      mockClient.getContents
        .mockResolvedValueOnce([
          { name: 'apps', type: 'dir' },
          { name: 'packages', type: 'dir' },
          { name: 'package.json', type: 'file' },
        ])
        .mockResolvedValueOnce([
          { name: 'package.json', type: 'file' },
          { name: 'tsconfig.json', type: 'file' },
          { name: 'src', type: 'dir' },
        ])
        .mockResolvedValueOnce([
          { name: 'package.json', type: 'file' },
          { name: 'Cargo.toml', type: 'file' },
        ])
        .mockResolvedValueOnce([
          { name: 'package.json', type: 'file' },
          { name: 'src', type: 'dir' },
        ]);

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const boundaries = await detector.detectPackageBoundaries('owner', 'repo');
      
      expect(boundaries.length).toBeGreaterThanOrEqual(2);
      expect(boundaries.some(b => b.packageName === 'apps')).toBe(true);
      expect(boundaries.some(b => b.packageName === 'packages')).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should ignore node_modules and other patterns', async () => {
      mockClient.getContents.mockResolvedValue([
        { name: 'node_modules', type: 'dir' },
        { name: 'target', type: 'dir' },
        { name: 'src', type: 'dir' },
      ]);

      mockClient.getContents.mockResolvedValue([
        { name: 'index.ts', type: 'file' },
      ]);

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const boundaries = await detector.detectPackageBoundaries('owner', 'repo');
      
      // Should not include node_modules or target
      expect(boundaries.every(b => b.packageName !== 'node_modules')).toBe(true);
      expect(boundaries.every(b => b.packageName !== 'target')).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('validateBoundaries', () => {
    it('should detect self-dependencies', async () => {
      const boundaries: MonorepoPackageBoundary[] = [
        {
          packageName: 'app',
          path: 'apps/app',
          languages: ['TypeScript'],
          dependencies: ['app', 'shared'],
          hasPackageJson: true,
          hasCargoToml: false,
          hasGoMod: false,
          hasPyProject: false,
        },
      ];

      const result = await detector.validateBoundaries(boundaries);
      
      expect(result.valid).toBe(false);
      expect(result.violations).toContain('Package app has self-dependency');
    });

    it('should detect circular dependencies', async () => {
      const boundaries: MonorepoPackageBoundary[] = [
        {
          packageName: 'app',
          path: 'apps/app',
          languages: ['TypeScript'],
          dependencies: ['shared'],
          hasPackageJson: true,
          hasCargoToml: false,
          hasGoMod: false,
          hasPyProject: false,
        },
        {
          packageName: 'shared',
          path: 'packages/shared',
          languages: ['TypeScript'],
          dependencies: ['app'],
          hasPackageJson: true,
          hasCargoToml: false,
          hasGoMod: false,
          hasPyProject: false,
        },
      ];

      const result = await detector.validateBoundaries(boundaries);
      
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should validate clean boundaries', async () => {
      const boundaries: MonorepoPackageBoundary[] = [
        {
          packageName: 'app',
          path: 'apps/app',
          languages: ['TypeScript'],
          dependencies: ['shared'],
          hasPackageJson: true,
          hasCargoToml: false,
          hasGoMod: false,
          hasPyProject: false,
        },
        {
          packageName: 'shared',
          path: 'packages/shared',
          languages: ['TypeScript'],
          dependencies: [],
          hasPackageJson: true,
          hasCargoToml: false,
          hasGoMod: false,
          hasPyProject: false,
        },
      ];

      const result = await detector.validateBoundaries(boundaries);
      
      expect(result.valid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });


});
