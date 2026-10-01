// src/cli/exitCodes.ts
import { logger } from '../utils/logger';

export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  VALIDATION_ERROR = 2,
  POLICY_VIOLATION = 3,
  NETWORK_ERROR = 4,
  AUTH_ERROR = 5,
}

export class CliError extends Error {
  constructor(public code: ExitCode, message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function handleCliError(error: unknown): void {
  let exitCode = ExitCode.GENERAL_ERROR;
  let errorMessage = 'An unexpected error occurred';

  if (error instanceof CliError) {
    exitCode = error.code;
    errorMessage = error.message;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  logger.error({ exitCode, err: error }, errorMessage);
  console.error(`Error: ${errorMessage}`);
  process.exit(exitCode);
}