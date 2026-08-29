import {
  detectDuplicateSignatureVerifications,
} from '../src/authorization/duplicate-signature-verification-rule';
import {
  detectAuthorizationInLoops,
} from '../src/authorization/authorization-in-loops-rule';
import {
  detectRecursiveContractCalls,
} from '../src/calls/recursive-contract-calls-rule';
import {
  detectCallDepthThresholdExceeded,
} from '../src/calls/call-depth-threshold-rule';

describe('GasGuard Soroban Rules (#899, #874, #878, #879)', () => {
  describe('Issue #899: Detect Duplicate Signature Verification', () => {
    it('detects repeated signature verification on identical inputs', () => {
      const code = `
        pub fn process_tx(env: Env, sig: Signature, msg: Bytes) {
          env.crypto().ed25519_verify(&sig, &msg);
          // Some logic
          env.crypto().ed25519_verify(&sig, &msg);
        }
      `;
      const findings = detectDuplicateSignatureVerifications(code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].ruleId).toBe('soroban-duplicate-signature-verification');
      expect(findings[0].message).toContain('Duplicate signature verification');
    });

    it('returns no findings when signature verification is performed only once', () => {
      const code = `
        pub fn process_tx(env: Env, sig: Signature, msg: Bytes) {
          env.crypto().ed25519_verify(&sig, &msg);
        }
      `;
      const findings = detectDuplicateSignatureVerifications(code);
      expect(findings).toHaveLength(0);
    });
  });

  describe('Issue #874: Detect Authorization Inside Expensive Loops', () => {
    it('detects require_auth inside a for loop', () => {
      const code = `
        pub fn process_users(env: Env, users: Vec<Address>) {
          for user in users.iter() {
            user.require_auth();
          }
        }
      `;
      const findings = detectAuthorizationInLoops(code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].ruleId).toBe('soroban-auth-in-loops');
      expect(findings[0].severity).toBe('high');
      expect(findings[0].suggestion).toContain('Hoist');
    });

    it('returns no findings when authorization is outside the loop', () => {
      const code = `
        pub fn process_users(env: Env, admin: Address, users: Vec<Address>) {
          admin.require_auth();
          for user in users.iter() {
            // process
          }
        }
      `;
      const findings = detectAuthorizationInLoops(code);
      expect(findings).toHaveLength(0);
    });
  });

  describe('Issue #878: Detect Recursive Soroban Contract Calls', () => {
    it('detects direct recursion within a contract function', () => {
      const code = `
        pub fn calculate_factorial(n: u32) -> u32 {
          if n == 0 { return 1; }
          n * calculate_factorial(n - 1)
        }
      `;
      const findings = detectRecursiveContractCalls(code);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].ruleId).toBe('soroban-recursive-calls');
      expect(findings[0].message).toContain('Direct recursion detected');
    });

    it('returns no findings for non-recursive function calls', () => {
      const code = `
        pub fn helper() -> u32 { 42 }
        pub fn main_fn() -> u32 { helper() }
      `;
      const findings = detectRecursiveContractCalls(code);
      expect(findings).toHaveLength(0);
    });
  });

  describe('Issue #879: Implement Soroban Call Depth Threshold Rule', () => {
    it('detects call depth exceeding default threshold', () => {
      const code = `
        pub fn fn_level_1() { fn_level_2(); }
        pub fn fn_level_2() { fn_level_3(); }
        pub fn fn_level_3() { fn_level_4(); }
        pub fn fn_level_4() { fn_level_5(); }
        pub fn fn_level_5() { }
      `;
      const findings = detectCallDepthThresholdExceeded(code, { maxDepth: 3 });
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].ruleId).toBe('soroban-call-depth-threshold');
      expect(findings[0].message).toContain('invocation chain depth is');
    });

    it('respects custom threshold option', () => {
      const code = `
        pub fn a() { b(); }
        pub fn b() { c(); }
        pub fn c() { }
      `;
      const findingsExceeded = detectCallDepthThresholdExceeded(code, { maxDepth: 2 });
      expect(findingsExceeded.length).toBeGreaterThan(0);

      const findingsOk = detectCallDepthThresholdExceeded(code, { maxDepth: 10 });
      expect(findingsOk).toHaveLength(0);
    });
  });
});
