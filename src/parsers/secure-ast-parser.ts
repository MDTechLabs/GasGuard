/**
 * Secure AST Parsing Layer
 *
 * Wraps parsers with input validation and safe error handling
 * to prevent crashes on malformed or malicious input.
 */

export interface ParseResult<T> {
  success: boolean;
  ast?: T;
  error?: string;
}

export interface ParserOptions {
  maxInputLength?: number;
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<ParserOptions> = {
  maxInputLength: 1_000_000, // 1 MB
  timeoutMs: 5000,
};

/**
 * Validate raw source input before parsing
 */
function validateInput(source: string, maxLength: number): string | null {
  if (typeof source !== 'string') {
    return 'Input must be a string';
  }
  if (source.length === 0) {
    return 'Input is empty';
  }
  if (source.length > maxLength) {
    return `Input exceeds maximum length of ${maxLength} characters`;
  }
  return null;
}

/**
 * Execute a parser function with a timeout guard
 */
async function withTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Parser timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    Promise.resolve()
      .then(() => fn())
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Safely parse source code using the provided parser function.
 * Handles validation, timeouts, and unexpected errors.
 */
export async function secureParse<T>(
  source: string,
  parser: (src: string) => T | Promise<T>,
  options: ParserOptions = {}
): Promise<ParseResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const validationError = validateInput(source, opts.maxInputLength);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const ast = await withTimeout(() => parser(source), opts.timeoutMs);
    return { success: true, ast };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
