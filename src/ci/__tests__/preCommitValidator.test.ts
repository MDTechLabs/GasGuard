// src/ci/__tests__/preCommitValidator.test.ts
import { PreCommitValidator } from '../preCommitValidator';

describe('Pre-Commit Validator Service (#1074)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('irrelevant and empty staged file sets', () => {
    it('passes successfully when no relevant files are staged', async () => {
      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: ['README.md', 'docs/architecture.md', '.gitignore'],
      });
      expect(result).toBe(true);
    });

    it('handles empty staged file lists gracefully', async () => {
      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: [],
      });
      expect(result).toBe(true);
    });

    it('normalizes Windows-style backslashes and duplicate paths', async () => {
      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: [
          'docs\\guide.md',
          'contracts\\Vault.sol',
          'contracts/Vault.sol',
        ],
      });
      expect(result).toBe(true);
    });
  });

  describe('smart contract and source file validation', () => {
    it('successfully validates staged Solidity smart contract files', async () => {
      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: ['contracts/Vault.sol', 'contracts/Token.sol'],
      });
      expect(result).toBe(true);
    });

    it('successfully validates staged Rust / Soroban contract files', async () => {
      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: ['contracts/pool/src/lib.rs', 'Cargo.toml'],
      });
      expect(result).toBe(true);
    });

    it('successfully validates mixed contract and application source files', async () => {
      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: [
          'contracts/Vault.sol',
          'src/index.ts',
          'src/utils/format.ts',
          'README.md',
        ],
      });
      expect(result).toBe(true);
    });
  });

  describe('failure handling and edge cases', () => {
    it('fails or rejects when a validator check throws or returns a failure', async () => {
      const spy = jest
        .spyOn(PreCommitValidator, 'validateStagedFiles')
        .mockResolvedValueOnce(false);

      const result = await PreCommitValidator.validateStagedFiles({
        stagedFiles: ['contracts/BrokenVault.sol'],
      });

      expect(result).toBe(false);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('propagates or handles unexpected errors cleanly', async () => {
      jest
        .spyOn(PreCommitValidator, 'validateStagedFiles')
        .mockRejectedValueOnce(new Error('Toolchain check timed out'));

      await expect(
        PreCommitValidator.validateStagedFiles({
          stagedFiles: ['contracts/Vault.sol'],
        })
      ).rejects.toThrow('Toolchain check timed out');
    });
  });
});