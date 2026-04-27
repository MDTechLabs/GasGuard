/**
 * Sandbox Errors
 * 
 * Specialized errors for sandboxed execution failures
 */

export class SandboxError extends Error {
  constructor(public message: string, public code: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

export class SandboxTimeoutError extends SandboxError {
  constructor(timeoutMs: number) {
    super(`Rule execution timed out after ${timeoutMs}ms`, 'TIMEOUT');
    this.name = 'SandboxTimeoutError';
  }
}

export class SandboxCrashError extends SandboxError {
  constructor(originalError: Error) {
    super(`Rule execution crashed: ${originalError.message}`, 'CRASH');
    this.name = 'SandboxCrashError';
    this.stack = originalError.stack;
  }
}

export class SandboxPolicyError extends SandboxError {
  constructor(message: string) {
    super(`Rule violated sandbox policy: ${message}`, 'POLICY_VIOLATION');
    this.name = 'SandboxPolicyError';
  }
}
