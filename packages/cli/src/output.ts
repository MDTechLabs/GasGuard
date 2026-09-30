import ora from "ora";

export interface CliOptions {
  quiet?: boolean;
  progress?: boolean;
  config?: string;
}

let cliOptions: CliOptions = {};

export interface CliProgress {
  text: string;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

export function setCliOptions(options: CliOptions): void {
  cliOptions = options;
}

export function getCliOptions(): CliOptions {
  return cliOptions;
}

export function logInfo(...values: unknown[]): void {
  if (!cliOptions.quiet) {
    console.log(...values);
  }
}

export function logError(...values: unknown[]): void {
  console.error(...values);
}

export function shouldShowProgress(
  options: CliOptions,
  isTty: boolean,
): boolean {
  return !options.quiet && options.progress !== false && isTty;
}

export function startProgress(text: string): CliProgress {
  const enabled = shouldShowProgress(cliOptions, Boolean(process.stderr.isTTY));
  if (!enabled) {
    return {
      text,
      succeed: () => undefined,
      fail: () => undefined,
      stop: () => undefined,
    };
  }
  return ora({ text, stream: process.stderr }).start();
}

export function finishProgress(
  progress: CliProgress,
  text: string,
  failed = false,
): void {
  if (failed) {
    progress.fail(text);
  } else {
    progress.succeed(text);
  }
}

export function resolveConfigPath(): string {
  return cliOptions.config || "gasguard.config.json";
}
