import { ContractPatternLibrary } from './contract-pattern-library';
import {
  PatternCategory,
  PatternSeverity,
  ContractPattern,
  PatternMatch,
} from './types';

describe('ContractPatternLibrary', () => {
  let library: ContractPatternLibrary;

  const samplePattern: ContractPattern = {
    id: 'soroban-auth-check',
    name: 'Authentication Check',
    description: 'Detects missing authentication checks on public functions',
    category: PatternCategory.AUTHENTICATION,
    severity: PatternSeverity.HIGH,
    tags: ['auth', 'access-control', 'security'],
    detectionLogic: {
      type: 'ast-node',
      matcher: {
        nodeType: 'FunctionDefinition',
        properties: { isPublic: true },
        children: [
          {
            nodeType: 'RequireStatement',
            properties: {},
          },
        ],
      },
    },
    remediation:
      'Add requireAuth() or similar authentication check at the beginning of public functions.',
  };

  const secondPattern: ContractPattern = {
    id: 'soroban-storage-read',
    name: 'Storage Read Pattern',
    description: 'Detects storage read operations using env.storage()',
    category: PatternCategory.STORAGE,
    severity: PatternSeverity.INFO,
    tags: ['storage', 'data'],
    detectionLogic: {
      type: 'regex',
      matcher: /env\.storage\(\)\.get\(/,
    },
  };

  beforeEach(() => {
    library = new ContractPatternLibrary();
  });

  describe('registerPattern', () => {
    it('should register a new pattern', () => {
      library.registerPattern(samplePattern);
      expect(library.patternCount).toBe(1);
    });

    it('should throw when registering a duplicate pattern id', () => {
      library.registerPattern(samplePattern);
      expect(() => library.registerPattern(samplePattern)).toThrow(
        "Pattern with id 'soroban-auth-check' is already registered",
      );
    });
  });

  describe('findPattern', () => {
    it('should return the pattern by id', () => {
      library.registerPattern(samplePattern);
      const found = library.findPattern('soroban-auth-check');
      expect(found).toBeDefined();
      expect(found!.id).toBe('soroban-auth-check');
      expect(found!.name).toBe('Authentication Check');
    });

    it('should return undefined for unknown id', () => {
      const found = library.findPattern('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('listPatterns', () => {
    it('should return all patterns when no options given', () => {
      library.registerPattern(samplePattern);
      library.registerPattern(secondPattern);
      expect(library.listPatterns()).toHaveLength(2);
    });

    it('should filter by category', () => {
      library.registerPattern(samplePattern);
      library.registerPattern(secondPattern);
      const result = library.listPatterns({ category: PatternCategory.STORAGE });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('soroban-storage-read');
    });

    it('should filter by severity', () => {
      library.registerPattern(samplePattern);
      library.registerPattern(secondPattern);
      const result = library.listPatterns({ severity: PatternSeverity.HIGH });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('soroban-auth-check');
    });

    it('should filter by name', () => {
      library.registerPattern(samplePattern);
      library.registerPattern(secondPattern);
      const result = library.listPatterns({ name: 'Storage' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('soroban-storage-read');
    });

    it('should filter by tags', () => {
      library.registerPattern(samplePattern);
      library.registerPattern(secondPattern);
      const result = library.listPatterns({ tags: ['auth', 'security'] });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('soroban-auth-check');
    });

    it('should return empty array when no patterns match', () => {
      library.registerPattern(samplePattern);
      const result = library.listPatterns({ category: PatternCategory.EVENT });
      expect(result).toHaveLength(0);
    });
  });

  describe('detectPatterns', () => {
    it('should detect patterns against AST nodes', async () => {
      library.registerPattern(samplePattern);

      const ast: Record<string, unknown>[] = [
        {
          type: 'FunctionDefinition',
          isPublic: true,
          startLine: 10,
          endLine: 25,
          context: 'fn transfer(to: Address, amount: i128)',
          body: [
            { type: 'RequireStatement', startLine: 11, endLine: 11 },
          ],
        },
      ];

      const matches = await library.detectPatterns(ast);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].patternId).toBe('soroban-auth-check');
      expect(matches[0].confidence).toBeGreaterThan(0);
    });

    it('should return empty matches when no AST nodes match', async () => {
      library.registerPattern(samplePattern);

      const ast: Record<string, unknown>[] = [
        {
          type: 'VariableDeclaration',
          startLine: 1,
          endLine: 1,
        },
      ];

      const matches = await library.detectPatterns(ast);
      expect(matches).toHaveLength(0);
    });

    it('should detect multiple pattern matches', async () => {
      library.registerPattern(samplePattern);
      library.registerPattern(secondPattern);

      const ast: Record<string, unknown>[] = [
        {
          type: 'FunctionDefinition',
          isPublic: true,
          startLine: 10,
          endLine: 25,
          body: [{ type: 'RequireStatement', startLine: 11, endLine: 11 }],
        },
      ];

      const matches = await library.detectPatterns(ast);
      // secondPattern uses regex type which returns a placeholder match
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('unregisterPattern', () => {
    it('should remove a registered pattern', () => {
      library.registerPattern(samplePattern);
      expect(library.patternCount).toBe(1);
      const result = library.unregisterPattern('soroban-auth-check');
      expect(result).toBe(true);
      expect(library.patternCount).toBe(0);
    });

    it('should return false for nonexistent pattern', () => {
      const result = library.unregisterPattern('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty library', () => {
      expect(library.patternCount).toBe(0);
      expect(library.listPatterns()).toHaveLength(0);
    });

    it('should handle detection on empty AST', async () => {
      library.registerPattern(samplePattern);
      const matches = await library.detectPatterns([]);
      expect(matches).toHaveLength(0);
    });
  });
});
