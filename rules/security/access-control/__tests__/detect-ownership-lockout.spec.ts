import * as fs from 'fs';
import * as path from 'path';
import { normalizeAnalysisResult } from '../../../../libs/engine/core/result-normalizer';
import { SolidityAnalyzer } from '../../../../libs/engine/analyzers/solidity-analyzer';
import { detectOwnershipLockout } from '../detect-ownership-lockout';

const fixtureDir = path.resolve(__dirname, '../../../../tests/rules/fixtures');
const fixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'sol-028-ownership-lockout.json'), 'utf8'),
) as {
  expectedFindings: Array<{
    ruleId: string;
    contract: string;
    function: string;
    kind: string;
    line: number;
  }>;
  safeContracts: string[];
  immutableContracts: string[];
  permissionlessContracts: string[];
  exemptContracts: string[];
};
const source = fs.readFileSync(
  path.join(fixtureDir, 'sol-028-ownership-lockout.sol'),
  'utf8',
);

describe('sol-028 ownership lockout', () => {
  it('reports one-step, broken two-step, renounce, role, and mapping-admin flows in the fixture', () => {
    const result = detectOwnershipLockout(source);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.findings.map(({ ruleId, contract, function: fn, kind, line }) => ({
        ruleId,
        contract,
        function: fn,
        kind,
        line,
      })),
    ).toEqual(fixture.expectedFindings);
  });

  it('classifies safe, immutable, permissionless, and documented-exempt contracts', () => {
    const result = detectOwnershipLockout(source);
    const status = new Map(result.contracts.map((entry) => [entry.contract, entry.status]));

    for (const contract of fixture.safeContracts) {
      expect(status.get(contract)).toBe('safe');
      expect(result.findings.filter((finding) => finding.contract === contract)).toEqual([]);
    }
    for (const contract of fixture.immutableContracts) {
      expect(status.get(contract)).toBe('immutable');
    }
    for (const contract of fixture.permissionlessContracts) {
      expect(status.get(contract)).toBe('permissionless');
    }
    for (const contract of fixture.exemptContracts) {
      expect(status.get(contract)).toBe('exempt');
    }
  });

  it('detects unprotected role revocation and self-renunciation', () => {
    const result = detectOwnershipLockout(`
      contract Roles {
        mapping(bytes32 => mapping(address => bool)) public hasRole;
        function revokeRole(bytes32 role, address account) external {
          _revokeRole(role, account);
        }
        function renounceRole(bytes32 role) external {
          _revokeRole(role, msg.sender);
        }
        function _revokeRole(bytes32 role, address account) internal {
          hasRole[role][account] = false;
        }
      }
    `);

    expect(result.findings.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['unprotected-role-revocation', 'last-admin-renunciation']),
    );
  });

  it('distinguishes explicit zero assignment from acceptance without pending-owner authentication', () => {
    const result = detectOwnershipLockout(`
      contract Reset {
        address public owner;
        function reset() external {
          owner = address(0);
        }
        function setFee(uint256 fee) external {
          require(msg.sender == owner, "owner");
        }
      }
      contract WrongAccept {
        address public owner;
        address public pendingOwner;
        function transferOwnership(address newOwner) external {
          require(msg.sender == owner, "owner");
          require(newOwner != address(0), "zero");
          pendingOwner = newOwner;
        }
        function acceptOwnership() external {
          require(msg.sender == owner, "owner");
          owner = msg.sender;
          delete pendingOwner;
        }
        function setFee(uint256 fee) external {
          require(msg.sender == owner, "owner");
        }
      }
    `);

    expect(result.findings.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'ownership-transfer-to-zero',
        'acceptance-not-pending-owner',
      ]),
    );
  });

  it('accepts guarded last-admin revocation, zero checks, and two-step acceptance', () => {
    expect(
      detectOwnershipLockout(`
        contract Guarded {
          mapping(bytes32 => uint256) public roleMemberCount;
          function revokeRole(bytes32 role, address account) external {
            require(roleMemberCount[role] > 1, "last admin");
            roleMemberCount[role] -= 1;
          }
        }
      `).findings,
    ).toEqual([]);

    expect(
      detectOwnershipLockout(`
        contract TwoStep {
          address public owner;
          address public pendingOwner;
          modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }
          function transferOwnership(address newOwner) external onlyOwner {
            require(newOwner != address(0), "zero");
            pendingOwner = newOwner;
          }
          function acceptOwnership() external {
            require(msg.sender == pendingOwner, "pending");
            owner = msg.sender;
            delete pendingOwner;
          }
        }
      `).findings,
    ).toEqual([]);
  });

  it('ignores comments, strings, internal helpers, and non-admin role variables', () => {
    const result = detectOwnershipLockout(`
      contract Notes {
        address public owner;
        string note = "owner = newOwner;";
        // function transferOwnership(address newOwner) external { owner = newOwner; }
        function setFee(uint256 fee) external {
          require(msg.sender == owner, "owner");
        }
        function _setOwner(address newOwner) internal {
          owner = newOwner;
        }
        function rotate(bytes32 role, address account) external {
          require(msg.sender == owner, "owner");
          role;
          account;
        }
      }
    `);

    expect(result.findings).toEqual([]);
  });

  it('fails safely on malformed or non-string input', () => {
    expect(detectOwnershipLockout('contract Broken {').diagnostics[0].code).toBe(
      'unbalanced-delimiters',
    );
    expect(detectOwnershipLockout({}).diagnostics[0].message).toContain(
      'must be a string',
    );
    expect(detectOwnershipLockout(null).diagnostics[0].message).toContain(
      'must be a string',
    );
    expect(() => detectOwnershipLockout(undefined)).not.toThrow();
  });

  it('keeps a stable result shape for generated malformed source', () => {
    let seed = 0x2f6e2b1;
    const alphabet = '{}()[];/*\'"\n contract owner revokeRole address(0) ';

    for (let iteration = 0; iteration < 200; iteration += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const length = seed % 80;
      let generated = '';

      for (let index = 0; index < length; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        generated += alphabet[seed % alphabet.length];
      }

      const result = detectOwnershipLockout(generated);
      expect(Array.isArray(result.findings)).toBe(true);
      expect(Array.isArray(result.diagnostics)).toBe(true);
      expect(Array.isArray(result.flows)).toBe(true);
      expect(Array.isArray(result.contracts)).toBe(true);
      expect(typeof result.analyzed).toBe('boolean');
    }
  });

  it('integrates with the analyzer and the normalized finding schema', async () => {
    const analyzer = new SolidityAnalyzer();
    const file = 'tests/rules/fixtures/sol-028-ownership-lockout.sol';
    const rules = Object.fromEntries(
      analyzer.getRules().map(({ id }) => [id, { enabled: id === 'sol-028' }]),
    );
    const result = await analyzer.analyze(source, file, { rules });
    const normalized = normalizeAnalysisResult(result);
    const expected = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../../tests/rules/expected/sol-028-normalized.json'),
        'utf8',
      ),
    );

    expect(result.findings).toHaveLength(fixture.expectedFindings.length);
    expect(result.findings[0]).toMatchObject({
      ruleId: 'sol-028',
      location: { file, startLine: 14 },
      metadata: {
        contract: 'UnsafeOneStepOwner',
        entryPoint: 'transferOwnership',
        kind: 'one-step-ownership-transfer',
        confidenceEvidence: expect.any(Array),
        severityRationale: expect.any(String),
        limitation: expect.any(String),
      },
    });
    expect(normalized.findings).toEqual(expected);
  });
});
