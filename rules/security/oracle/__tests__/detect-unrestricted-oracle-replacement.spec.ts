import { detectUnrestrictedOracleReplacement } from '../detect-unrestricted-oracle-replacement';
import * as fx from './oracle-replacement.fixtures';

type Opts = Parameters<typeof detectUnrestrictedOracleReplacement>[1];
const run = (src: string, opts?: Opts) => detectUnrestrictedOracleReplacement(src, opts);
const kinds = (src: string, opts?: Opts) => run(src, opts).findings.map((f) => f.kind);

describe('detectUnrestrictedOracleReplacement', () => {
  it('flags an unrestricted setter as critical and names the dependent financial function', () => {
    const { findings } = run(fx.UNRESTRICTED_SETTER);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.ruleId).toBe('GG-ORACLE-REPLACE-001');
    expect(f.kind).toBe('unrestricted-oracle-replacement');
    expect(f.severity).toBe('critical');
    expect(f.function).toBe('setOracle');
    expect(f.message).toMatch(/borrow\(\) use oracle for financial logic/);
    expect(f.details).toMatchObject({ privilegedPath: ['any caller'], dependents: ['borrow'] });
  });

  it('lowers severity when nothing in the file depends on the oracle', () => {
    const [f] = run(fx.UNRESTRICTED_NO_DEPENDENTS).findings;
    expect(f.kind).toBe('unrestricted-oracle-replacement');
    expect(f.severity).toBe('high');
    expect(f.message).toMatch(/no dependent financial function/);
  });

  it('reports a privileged but immediate and unvalidated replacement with its privileged path', () => {
    const [f] = run(fx.OWNER_IMMEDIATE).findings;
    expect(f.kind).toBe('immediate-privileged-replacement');
    expect(f.severity).toBe('medium');
    expect(f.details).toMatchObject({ privilegedPath: ['onlyOwner'], dependents: ['borrow'] });
  });

  it('resolves role-gated setters and where the role is granted', () => {
    const r = run(fx.ROLE_GATED);
    expect(r.findings.map((f) => f.kind)).toEqual(['immediate-privileged-replacement']);
    expect(r.findings[0].details).toMatchObject({
      roles: ['ORACLE_ADMIN'],
      roleGrants: [{ role: 'ORACLE_ADMIN', in: 'constructor' }],
    });
    expect(r.roleGrants).toEqual([{ role: 'ORACLE_ADMIN', in: 'constructor' }]);
  });

  it('accepts a timelocked, validated replacement flow', () => {
    const r = run(fx.SAFE_TIMELOCKED_AND_VALIDATED);
    expect(r.findings).toEqual([]);
    expect(r.setters).toEqual([
      expect.objectContaining({ variable: 'oracle', function: 'proposeOracle', access: 'restricted', delay: true, validated: true }),
    ]);
  });

  it('supports a documented emergency replacement policy', () => {
    const safe = run(fx.SAFE_EMERGENCY_POLICY);
    expect(safe.findings).toEqual([]);
    expect(safe.setters[0]).toMatchObject({ emergency: true, delay: true, validated: true });
    const [f] = run(fx.EMERGENCY_UNVALIDATED).findings;
    expect(f.kind).toBe('replacement-without-validation');
    expect(f.details).toMatchObject({ emergencyPolicy: true });
    expect(f.message).toMatch(/documented emergency path/);
  });

  it('flags a per-token feed mapping that anyone can write', () => {
    const [f] = run(fx.UNRESTRICTED_FEED_MAPPING).findings;
    expect(f.kind).toBe('unrestricted-oracle-replacement');
    expect(f.details).toMatchObject({ variable: 'feeds', dependents: ['value'] });
  });

  it('resolves inline msg.sender checks and modifiers defined in the same file', () => {
    expect(run(fx.INLINE_ADMIN_CHECK).findings[0].details).toMatchObject({ privilegedPath: ['msg.sender == admin'] });
    expect(run(fx.MODIFIER_DEFINED_IN_FILE).findings[0].details).toMatchObject({ privilegedPath: ['modifier onlyAdmin'] });
  });

  it('does not treat a non-restrictive modifier as access control', () => {
    expect(kinds(fx.ONLY_PAUSE_MODIFIER)).toEqual(['unrestricted-oracle-replacement']);
  });

  it('reports a validated replacement that lacks a delay as low severity', () => {
    const [f] = run(fx.VALIDATED_NO_DELAY).findings;
    expect(f.kind).toBe('privileged-replacement-no-delay');
    expect(f.severity).toBe('low');
  });

  it('honours configured trusted modifiers and oracle names', () => {
    const src = fx.OWNER_IMMEDIATE.replace('onlyOwner', 'onlyTreasurer');
    expect(run(src).findings[0].confidence).toBe('high'); // contract inherits Ownable
    const custom = `
pragma solidity ^0.8.20;
contract Lender {
  address public quoteSource;
  function setQuoteSource(address q) external { quoteSource = q; }
  function value(uint256 x) external view returns (uint256) { return x * IQuote(quoteSource).price(); }
}`;
    expect(kinds(custom)).toEqual([]);
    expect(kinds(custom, { oracleNames: ['quoteSource'] })).toEqual(['unrestricted-oracle-replacement']);
  });

  it('ignores non-oracle setters and constructor-only assignment', () => {
    expect(kinds(fx.NON_ORACLE_SETTER)).toEqual([]);
    expect(kinds(fx.CONSTRUCTOR_ONLY)).toEqual([]);
  });

  it('fails safely on malformed or unsupported input', () => {
    for (const bad of [undefined, 9, '', 'oracle = IOracle(o);']) {
      const r = run(bad as unknown as string);
      expect(r.analyzed).toBe(false);
      expect(r.findings).toEqual([]);
      expect(r.setters).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('keeps analyzing truncated source and records a diagnostic', () => {
    const cut = fx.UNRESTRICTED_SETTER.slice(0, fx.UNRESTRICTED_SETTER.indexOf('oracle = IOracle(o); }') + 21);
    const r = run(cut);
    expect(r.diagnostics.map((d) => d.code)).toContain('unbalanced-delimiters');
    expect(r.findings.map((f) => f.kind)).toEqual(['unrestricted-oracle-replacement']);
  });
});
