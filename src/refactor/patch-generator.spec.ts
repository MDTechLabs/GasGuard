import { PatchGenerator } from './patch-generator';
import { TextReplacement } from './ast-rewriter';

describe('PatchGenerator', () => {
  let generator: PatchGenerator;

  beforeEach(() => {
    generator = new PatchGenerator();
  });

  it('should generate a valid unified patch diff for Solidity code refactors', () => {
    const filePath = 'contracts/Staking.sol';
    const original = `contract Staking {\n    function run() public {\n        for (uint i = 0; i < items.length; i++) {}\n    }\n}`;
    const replacements: TextReplacement[] = [
      {
        startLine: 3,
        endLine: 3,
        originalText: '        for (uint i = 0; i < items.length; i++) {}',
        replacementText: '        uint256 len = items.length;\n        for (uint i = 0; i < len; i++) {}',
      },
    ];

    const patch = generator.generatePatchFromReplacements(filePath, original, replacements);

    expect(patch).toContain(`--- a/${filePath}`);
    expect(patch).toContain(`+++ b/${filePath}`);
    expect(patch).toContain('-        for (uint i = 0; i < items.length; i++) {}');
    expect(patch).toContain('+        uint256 len = items.length;');
    expect(patch).toContain('+        for (uint i = 0; i < len; i++) {}');
  });

  it('should generate patch diff in under 50ms (benchmark check)', () => {
    const filePath = 'soroban/src/lib.rs';
    const original = `pub fn test() {\n    env.storage().persistent().get(&key);\n}`;
    const replacements: TextReplacement[] = [
      {
        startLine: 2,
        endLine: 2,
        originalText: '    env.storage().persistent().get(&key);',
        replacementText: '    env.storage().temporary().get(&key);',
      },
    ];

    const start = Date.now();
    const patch = generator.generatePatchFromReplacements(filePath, original, replacements);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(50);
    expect(patch).toContain('env.storage().temporary()');
  });
});
