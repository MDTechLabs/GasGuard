import { StellarKnowledgeBase } from '../kb';

describe('StellarKnowledgeBase', () => {
  let kb: StellarKnowledgeBase;

  beforeEach(() => {
    kb = new StellarKnowledgeBase();
  });

  describe('getAllRules', () => {
    it('should return all registered rules', () => {
      const rules = kb.getAllRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some(r => r.id === 'stellar-network-validation')).toBe(true);
    });
  });

  describe('getRule', () => {
    it('should return a specific rule by id', () => {
      const rule = kb.getRule('stellar-network-validation');
      expect(rule).toBeDefined();
      expect(rule?.name).toBe('Stellar Network Validation');
    });

    it('should return undefined for a non-existent rule id', () => {
      const rule = kb.getRule('non-existent-rule');
      expect(rule).toBeUndefined();
    });
  });

  describe('search', () => {
    it('should return all rules when query is empty', () => {
      const results = kb.search('');
      expect(results.length).toBe(kb.getAllRules().length);
    });

    it('should search case-insensitively', () => {
      const queryLower = 'validation';
      const queryUpper = 'VALIDATION';
      
      const resultsLower = kb.search(queryLower);
      const resultsUpper = kb.search(queryUpper);
      
      expect(resultsLower.length).toBeGreaterThan(0);
      expect(resultsLower.length).toBe(resultsUpper.length);
      expect(resultsLower.some(r => r.id === 'stellar-network-validation')).toBe(true);
    });

    it('should search across tags', () => {
      const results = kb.search('passphrase');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.id === 'stellar-network-validation')).toBe(true);
    });

    it('should search across explanations', () => {
      const results = kb.search('deserialization');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.id === 'serialization-upgrade-compatibility')).toBe(true);
    });

    it('should filter by category', () => {
      const results = kb.search('', { category: 'Security' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.category === 'Security')).toBe(true);
    });

    it('should filter by severity', () => {
      const results = kb.search('', { severity: 'critical' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(r => r.severity === 'critical')).toBe(true);
    });

    it('should limit results count', () => {
      const results = kb.search('', { limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe('linkFinding', () => {
    it('should enrich a finding with a recognized ruleId', () => {
      const finding: {
        ruleId: string;
        message: string;
        suggestedFix?: {
          description?: string;
          codeSnippet?: string;
          documentationUrl?: string;
        };
      } = {
        ruleId: 'stellar-network-validation',
        message: 'Missing network validation'
      };

      const enriched = kb.linkFinding(finding);
      
      expect(enriched.suggestedFix).toBeDefined();
      expect(enriched.suggestedFix?.documentationUrl).toBe('docs/STELLAR_NETWORK_VALIDATION_RULE.md');
      expect(enriched.suggestedFix?.description).toContain('Remediation suggestion');
      expect(enriched.suggestedFix?.codeSnippet).toContain('network_passphrase');
    });

    it('should not overwrite existing suggestedFix fields if already set', () => {
      const finding = {
        ruleId: 'stellar-network-validation',
        message: 'Missing network validation',
        suggestedFix: {
          documentationUrl: 'custom/doc/url',
          description: 'Custom description',
          codeSnippet: 'Custom snippet'
        }
      };

      const enriched = kb.linkFinding(finding);
      
      expect(enriched.suggestedFix?.documentationUrl).toBe('custom/doc/url');
      expect(enriched.suggestedFix?.description).toBe('Custom description');
      expect(enriched.suggestedFix?.codeSnippet).toBe('Custom snippet');
    });

    it('should return the original finding unmodified if ruleId is unrecognized', () => {
      const finding = {
        ruleId: 'unknown-rule',
        message: 'Some issue'
      };

      const enriched = kb.linkFinding(finding);
      expect(enriched).toEqual(finding);
    });
  });
});
