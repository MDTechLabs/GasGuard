// src/cli/__tests__/exitCodes.spec.ts
import { ExitCode, CliError } from '../exitCodes';
import { ValidationError, PolicyViolationError, NetworkError, AuthError } from '../errors';

describe('CLI Exit Codes & Error Handling (#1057)', () => {
  it('assigns correct exit codes to domain error classes', () => {
    const validationErr = new ValidationError('Invalid argument');
    const policyErr = new PolicyViolationError('Gas limit exceeded');
    const networkErr = new NetworkError('RPC timeout');
    const authErr = new AuthError('Unauthorized key');

    expect(validationErr.code).toBe(ExitCode.VALIDATION_ERROR); // 2
    expect(policyErr.code).toBe(ExitCode.POLICY_VIOLATION);     // 3
    expect(networkErr.code).toBe(ExitCode.NETWORK_ERROR);       // 4
    expect(authErr.code).toBe(ExitCode.AUTH_ERROR);             // 5
  });

  it('inherits from CliError properly', () => {
    const err = new CliError(ExitCode.GENERAL_ERROR, 'Generic failure');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(ExitCode.GENERAL_ERROR);
    expect(err.message).toBe('Generic failure');
  });
});