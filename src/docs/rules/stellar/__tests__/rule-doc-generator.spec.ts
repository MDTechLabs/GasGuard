/**
 * Soroban Rule Documentation Generator — Tests (Issue #483)
 */

import {
  KBRule,
  generateDocs,
  generateStellarRuleDocs,
  parseRules,
  renderIndex,
  renderRulePage,
  slugify,
} from '../index';

function rule(overrides: Partial<KBRule> = {}): KBRule {
  return {
    id: 'soroban-storage-read',
    name: 'Soroban Storage Read Optimization',
    description: 'Identifies inefficient storage read patterns.',
    explanation: 'Repeated reads of the same key waste CPU and gas.',
    severity: 'medium',
    category: 'Optimization',
    remediation: 'let value = env.storage().instance().get(&key);',
    documentationUrl: 'docs/rules/general.md',
    tags: ['storage', 'gas'],
    ...overrides,
  };
}

describe('slugify', () => {
  it('produces a file/URL-safe slug', () => {
    expect(slugify('Stellar Network Validation')).toBe('stellar-network-validation');
    expect(slugify('soroban_map.iteration!')).toBe('soroban-map-iteration');
  });
});

describe('parseRules', () => {
  it('validates, slugs, dedups, and sorts by category then name', () => {
    const { rules, issues } = parseRules([
      rule({ id: 'b-rule', name: 'Beta', category: 'Security' }),
      rule({ id: 'a-rule', name: 'Alpha', category: 'Security' }),
      rule({ id: 'b-rule', name: 'Beta dup', category: 'Security' }),
    ]);
    expect(rules.map((r) => r.name)).toEqual(['Alpha', 'Beta']); // sorted, dup dropped
    expect(rules[0].slug).toBe('a-rule');
    expect(issues.some((i) => i.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('skips and reports invalid rules without throwing', () => {
    const { rules, issues } = parseRules([
      rule(),
      { ...rule({ id: 'bad' }), severity: 'extreme' as unknown as KBRule['severity'] },
      { ...rule({ id: 'noname' }), name: '' },
    ]);
    expect(rules).toHaveLength(1);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('SEVERITY_INVALID');
    expect(codes).toContain('NAME_REQUIRED');
  });
});

describe('renderRulePage', () => {
  it('includes the key metadata fields', () => {
    const [parsed] = parseRules([rule()]).rules;
    const md = renderRulePage(parsed);
    expect(md).toContain('# Soroban Storage Read Optimization');
    expect(md).toContain('`soroban-storage-read`');
    expect(md).toContain('Medium');
    expect(md).toContain('Optimization');
    expect(md).toContain('Identifies inefficient storage read patterns.');
    expect(md).toContain('## Remediation');
    expect(md).toContain('docs/rules/general.md');
  });

  it('fences multi-line / code remediation as a rust block', () => {
    const [parsed] = parseRules([
      rule({ remediation: 'let a = 1;\nlet b = 2;' }),
    ]).rules;
    const md = renderRulePage(parsed);
    expect(md).toContain('```rust');
  });
});

describe('renderIndex', () => {
  it('groups rules by category with links to their pages', () => {
    const { rules } = parseRules([
      rule({ id: 'sec-1', name: 'Sec One', category: 'Security' }),
      rule({ id: 'opt-1', name: 'Opt One', category: 'Optimization' }),
    ]);
    const md = renderIndex(rules);
    expect(md).toContain('## Security');
    expect(md).toContain('## Optimization');
    expect(md).toContain('[Sec One](rules/sec-1.md)');
    expect(md).toContain('2 rules');
  });
});

describe('generateDocs', () => {
  it('emits an index plus one page per valid rule', () => {
    const docs = generateDocs([
      rule({ id: 'r1', name: 'R1' }),
      rule({ id: 'r2', name: 'R2' }),
    ]);
    const paths = docs.map((d) => d.path);
    expect(paths).toContain('index.md');
    expect(paths).toContain('rules/r1.md');
    expect(paths).toContain('rules/r2.md');
    expect(docs).toHaveLength(3);
  });

  it('can omit the index and honour a custom pages dir', () => {
    const docs = generateDocs([rule({ id: 'r1' })], {
      includeIndex: false,
      pagesDir: 'pages',
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].path).toBe('pages/r1.md');
  });
});

describe('generateStellarRuleDocs (built-in catalogue)', () => {
  it('generates docs from the knowledge-base RULES', () => {
    const docs = generateStellarRuleDocs();
    expect(docs.length).toBeGreaterThan(1);
    expect(docs[0].path).toBe('index.md');
    // Every non-index page lives under rules/ and is Markdown.
    for (const doc of docs.slice(1)) {
      expect(doc.path).toMatch(/^rules\/[a-z0-9-]+\.md$/);
      expect(doc.content.startsWith('# ')).toBe(true);
    }
  });
});
