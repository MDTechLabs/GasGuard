/**
 * Rule Sandbox Service
 * 
 * Provides safe execution of dynamic rules with timeout and error isolation.
 * This prevents faulty rules from blocking the main event loop or crashing the system.
 */

import { ISandbox, SandboxOptions, SandboxResult } from './sandbox.interface';
import { SandboxTimeoutError, SandboxCrashError } from './sandbox.errors';

export class RuleSandbox implements ISandbox {
  private readonly defaultTimeoutMs = 5000;

  /**
   * Executes a rule function in a sandboxed environment
   */
  async execute<T = any, C = any>(
    task: (context: C) => Promise<T> | T,
    context: C,
    options: SandboxOptions = {}
  ): Promise<SandboxResult<T>> {
    const startTime = process.hrtime();
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    
    let timer: NodeJS.Timeout | null = null;

    try {
      // 1. Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new SandboxTimeoutError(timeoutMs));
        }, timeoutMs);
      });

      // 2. Execute the task wrapped in a promise
      const taskPromise = (async () => {
        try {
          return await task(context);
        } catch (error) {
          throw new SandboxCrashError(error instanceof Error ? error : new Error(String(error)));
        }
      })();

      // 3. Race against the timeout
      const data = await Promise.race([taskPromise, timeoutPromise]);

      return this.createSuccessResult(data, startTime);
    } catch (error) {
      return this.createFailureResult(error, startTime);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Helper to format successful results
   */
  private createSuccessResult<T>(data: T, startTime: [number, number]): SandboxResult<T> {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const durationMs = (seconds * 1000) + (nanoseconds / 1000000);

    return {
      success: true,
      data,
      metadata: {
        durationMs,
        timestamp: new Date(),
        resourceUsage: {
          memoryBytes: process.memoryUsage().heapUsed,
        }
      }
    };
  }

  /**
   * Helper to format failure results
   */
  private createFailureResult(error: any, startTime: [number, number]): SandboxResult<any> {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const durationMs = (seconds * 1000) + (nanoseconds / 1000000);

    let message = 'Unknown execution error';
    let code = 'EXECUTION_FAILED';
    let stack = undefined;

    if (error instanceof SandboxTimeoutError || error instanceof SandboxCrashError) {
      message = error.message;
      code = error.code;
      stack = error.stack;
    } else if (error instanceof Error) {
      message = error.message;
      stack = error.stack;
    }

    return {
      success: false,
      error: { message, code, stack },
      metadata: {
        durationMs,
        timestamp: new Date(),
      }
    };
  }
}
