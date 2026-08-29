import { describe, expect, it } from '@jest/globals';
import { StellarDependencyScanner } from './dependency-scanner';

describe('StellarDependencyScanner', () => {
  it('extracts dependencies from use statements', () => {
    const source = `pub struct Token;
use soroban_sdk::Env;`;

    const scanner = new StellarDependencyScanner(source, 'token.rs');
    const result = scanner.scan();

    expect(result.contractName).toBe('Token');
    expect(result.nodes.length).toBe(0);
    expect(result.directCount).toBe(0);
  });

  it('reports unused dependencies', () => {
    const source = `pub struct Test;
use some_unused_crate::Something;
use soroban_sdk::Env;
pub fn hello(env: Env) {}`;

    const scanner = new StellarDependencyScanner(source, 'test.rs');
    const result = scanner.scan();

    expect(result.nodes.some(n => n.name === 'some_unused_crate')).toBeTruthy();
    expect(result.unusedDependencies).toContain('some_unused_crate');
  });

  it('detects no circular dependencies in simple chain', () => {
    const source = `pub struct Linear;
use crate::a::A;
use soroban_sdk::Env;`;

    const scanner = new StellarDependencyScanner(source, 'linear.rs');
    const result = scanner.scan();

    expect(result.circularDependencies.length).toBe(0);
  });

  it('summarises scan results', () => {
    const source = `pub struct Summary;
use soroban_sdk::Env;
pub fn run(env: Env) {}`;

    const scanner = new StellarDependencyScanner(source, 'summary.rs');
    const result = scanner.scan();

    expect(result.summary).toContain('Summary');
    expect(result.directCount).toBeGreaterThanOrEqual(0);
  });
});
