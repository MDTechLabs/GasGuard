import { describe, expect, it } from '@jest/globals';
import { StellarMetadataExtractor } from './metadata-extractor';

describe('StellarMetadataExtractor', () => {
  it('extracts contract name and functions from Soroban source', () => {
    const source = `#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Address, Symbol};

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn initialize(env: Env, owner: Address, symbol: Symbol) {
        env.storage().instance().set(&"owner", &owner);
        env.storage().instance().set(&"symbol", &symbol);
    }

    pub fn transfer(env: Env, to: Address, amount: u64) {
        let owner: Address = env.storage().instance().get(&"owner").unwrap();
        owner.require_auth();
    }

    pub fn balance(env: Env, id: Address) -> u64 {
        env.storage().instance().get(&id).unwrap_or(0)
    }
}
`;

    const extractor = new StellarMetadataExtractor(source, 'token.rs');
    const metadata = extractor.extract();

    expect(metadata.name).toBe('TokenContract');
    expect(metadata.functions.length).toBeGreaterThanOrEqual(3);
    expect(metadata.storage.length).toBeGreaterThanOrEqual(2);
    expect(metadata.complexity.totalFunctions).toBe(metadata.functions.length);
  });

  it('generates a useful summary with insights', () => {
    const source = 'pub struct Simple;\npub fn do_auth() { require_auth(); }';
    const extractor = new StellarMetadataExtractor(source, 'simple.rs');
    const summary = extractor.summarize();

    expect(summary.contractName).toBe('Simple');
    expect(summary.totalFunctions).toBeGreaterThanOrEqual(0);
    expect(summary.keyInsights.length).toBeGreaterThanOrEqual(0);
  });

  it('detects authorization requirements', () => {
    const source = `pub fn transfer() { let owner: Address; owner.require_auth(); }
pub fn view() {}`;

    const extractor = new StellarMetadataExtractor(source, 'auth.rs');
    const metadata = extractor.extract();

    const transferFn = metadata.functions.find(f => f.name === 'transfer');
    expect(transferFn?.hasAuth).toBe(true);

    const viewFn = metadata.functions.find(f => f.name === 'view');
    expect(viewFn?.hasAuth).toBe(false);
  });
});
