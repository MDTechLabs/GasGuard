// src/cli/errors.ts
import { CliError, ExitCode } from './exitCodes';

export class ValidationError extends CliError {
  constructor(message: string) {
    super(ExitCode.VALIDATION_ERROR, message);
    this.name = 'ValidationError';
  }
}

export class PolicyViolationError extends CliError {
  constructor(message: string) {
    super(ExitCode.POLICY_VIOLATION, message);
    this.name = 'PolicyViolationError';
  }
}

export class NetworkError extends CliError {
  constructor(message: string) {
    super(ExitCode.NETWORK_ERROR, message);
    this.name = 'NetworkError';
  }
}

export class AuthError extends CliError {
  constructor(message: string) {
    super(ExitCode.AUTH_ERROR, message);
    this.name = 'AuthError';
  }
}