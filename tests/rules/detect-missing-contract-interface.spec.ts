import { detectMissingContractInterface } from '../../rules/auditability/interfaces/detect-missing-contract-interface';

describe('detectMissingContractInterface', () => {
  it('flags direct abi.encodeWithSignature calls', () => {
    const code = `bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", to, amount);`;
    const result = detectMissingContractInterface(code);
    expect(result.detected).toBe(true);
    expect(result.violations.some(v => v.type === 'direct-abi-encode')).toBe(true);
  });

  it('flags raw address casts', () => {
    const code = `IERC20(address(contractAddr)).transfer(to, amount);`;
    const result = detectMissingContractInterface(code);
    expect(result.detected).toBe(true);
  });

  it('returns clean for proper interface usage', () => {
    const code = `import "./IERC20.sol";\nIERC20(token).transfer(to, amount);`;
    const result = detectMissingContractInterface(code);
    expect(result.detected).toBe(false);
  });
});
