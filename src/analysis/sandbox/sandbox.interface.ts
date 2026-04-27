/**
 * Sandbox Interfaces
 * 
 * Defines the types for sandboxed rule execution
 */

export interface SandboxOptions {
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum memory usage in bytes (if supported by environment) */
  maxMemoryBytes?: number;
  /** Whether to enable detailed execution logs */
  debug?: boolean;
}

export interface SandboxResult<T = any> {
  /** Whether the rule executed successfully */
  success: boolean;
  /** The result returned by the rule */
  data?: T;
  /** Error information if execution failed */
  error?: {
    message: string;
    code: string;
    stack?: string;
  };
  /** Execution metadata */
  metadata: {
    durationMs: number;
    timestamp: Date;
    resourceUsage?: {
      memoryBytes?: number;
      cpuUsage?: number;
    };
  };
}

export interface ISandbox {
  /**
   * Execute a task in isolation
   * @param task The function to execute
   * @param context Data to pass to the task
   * @param options Sandbox configuration
   */
  execute<T = any, C = any>(
    task: (context: C) => Promise<T> | T,
    context: C,
    options?: SandboxOptions
  ): Promise<SandboxResult<T>>;
}
