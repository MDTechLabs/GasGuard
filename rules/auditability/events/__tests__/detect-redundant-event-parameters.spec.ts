import { detectRedundantEventParameters } from '../detect-redundant-event-parameters';

describe('detectRedundantEventParameters', () => {
  it('detects duplicate parameters in an event', () => {
    const code = `
      event Transfer(address indexed from, address indexed to, uint256 value, address from);
    `;
    const result = detectRedundantEventParameters(code);
    expect(result.detected).toBe(true);
    expect(result.redundancies.length).toBeGreaterThan(0);
  });

  it('passes when event parameters are unique', () => {
    const code = `
      event Transfer(address indexed from, address indexed to, uint256 value);
    `;
    const result = detectRedundantEventParameters(code);
    expect(result.detected).toBe(false);
  });

  it('detects redundant parameters in Soroban-style events', () => {
    const code = `
      pub struct TransferEvent {
        from: Address,
        to: Address,
        amount: i128,
        from: Address,
      }
    `;
    const result = detectRedundantEventParameters(code);
    expect(result.detected).toBe(true);
  });

  it('handles events with no parameters', () => {
    const code = `
      event Log();
    `;
    const result = detectRedundantEventParameters(code);
    expect(result.detected).toBe(false);
  });

  it('handles code without events', () => {
    const code = `
      function foo() external {}
    `;
    const result = detectRedundantEventParameters(code);
    expect(result.detected).toBe(false);
  });
});
