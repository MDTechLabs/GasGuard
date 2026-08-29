import { SolidityCachedLengthCheckRule } from '../src/cached-length-check';

describe('SolidityCachedLengthCheckRule', () => {
  let rule: SolidityCachedLengthCheckRule;

  beforeEach(() => {
    rule = new SolidityCachedLengthCheckRule();
  });

  it('should flag uncached state array length reads in for loops', () => {
    const code = `
      contract TestContract {
        address[] public stakers;

        function processStakers() public {
          for (uint256 i = 0; i < stakers.length; i++) {
            // do something
          }
        }
      }
    `;

    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(1);
    expect(warnings[0].arrayName).toBe('stakers');
    expect(warnings[0].suggestedRefactor).toContain('uint256 len = stakers.length');
  });

  it('should ignore memory and calldata array length reads in loops', () => {
    const code = `
      contract TestContract {
        function processItems(uint256[] calldata inputItems) public pure {
          uint256[] memory localItems = new uint256[](5);
          for (uint256 i = 0; i < localItems.length; i++) {}
          for (uint256 j = 0; j < inputItems.length; j++) {}
        }
      }
    `;

    const warnings = rule.analyze(code);
    expect(warnings.length).toBe(0);
  });
});
