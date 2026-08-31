import { analyzeSignatureVerification } from '../signature-verification-analyzer';

describe('Soroban Signature Verification Analyzer (Issue #898)', () => {
  test('detects signature verification operations and flags loop-embedded verification', () => {
    const source = `
use soroban_sdk::{contractimpl, BytesN, Env, Vec};

pub struct SigVerifier;

#[contractimpl]
impl SigVerifier {
    pub fn verify_batch(env: Env, pk: BytesN<32>, msg: BytesN<32>, sigs: Vec<BytesN<64>>) {
        for sig in sigs.iter() {
            env.crypto().ed25519_verify(&pk, &msg, &sig);
        }
    }
}
`;
    const report = analyzeSignatureVerification(source);

    expect(report.metrics.totalSignatureVerifications).toBe(1);
    expect(report.metrics.loopVerifications).toBe(1);
    expect(report.findings.some((f) => f.details.issueType === 'loop_embedded')).toBe(true);
  });

  test('detects repeated signature verification on identical payload', () => {
    const source = `
use soroban_sdk::{contractimpl, BytesN, Env};

pub struct Multicall;

#[contractimpl]
impl Multicall {
    pub fn process(env: Env, pk: BytesN<32>, msg: BytesN<32>, sig: BytesN<64>) {
        env.crypto().ed25519_verify(&pk, &msg, &sig);
        // ... later ...
        env.crypto().ed25519_verify(&pk, &msg, &sig); // duplicate!
    }
}
`;
    const report = analyzeSignatureVerification(source);

    expect(report.metrics.totalSignatureVerifications).toBe(2);
    expect(report.metrics.repeatedVerifications).toBe(1);
    expect(report.findings.some((f) => f.details.issueType === 'repeated_verification')).toBe(true);
  });
});
