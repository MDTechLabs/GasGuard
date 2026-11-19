/**
 * Runs an untrusted compiler invocation (e.g. solc) in a separate,
 * resource-limited child process with no network access.
 *
 * Limits: wall-clock timeout (SIGKILL), CPU seconds (ulimit -t), address space
 * (ulimit -v), max written file size (ulimit -f) and captured output size.
 * The command is executed via `sh -c 'ulimit ...; exec "$@"'` with arguments
 * passed positionally, so no argument is interpreted by a shell.
 * Output is returned to the caller and never logged here.
 */

import { spawn } from "child_process";
import { denyNetworkEnv, wrapWithNetworkDenial } from "./network-denial";

export interface WorkerLimits {
  timeoutMs: number;
  cpuSeconds: number;
  memoryKb: number;
  maxFileKb: number;
  maxOutputBytes: number;
}

export const DEFAULT_WORKER_LIMITS: Readonly<WorkerLimits> = {
  timeoutMs: 60_000,
  cpuSeconds: 60,
  memoryKb: 2 * 1024 * 1024,
  maxFileKb: 64 * 1024,
  maxOutputBytes: 10 * 1024 * 1024,
};

export interface WorkerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
}

export function runIsolated(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    limits?: Partial<WorkerLimits>;
    /** Defaults to true; set false only for trusted tooling. */
    denyNetwork?: boolean;
    platform?: string;
  } = {},
): Promise<WorkerResult> {
  const l = { ...DEFAULT_WORKER_LIMITS, ...options.limits };
  for (const v of [l.cpuSeconds, l.memoryKb, l.maxFileKb]) {
    if (!Number.isInteger(v) || v <= 0) {
      return Promise.reject(new RangeError("worker limits must be positive integers"));
    }
  }
  const script = `ulimit -t ${l.cpuSeconds}; ulimit -v ${l.memoryKb}; ulimit -f ${l.maxFileKb}; exec "$@"`;
  let spec = { command: "sh", args: ["-c", script, "sh", command, ...args] };
  const denyNetwork = options.denyNetwork !== false;
  if (denyNetwork) {
    spec = wrapWithNetworkDenial(spec.command, spec.args, options.platform);
  }
  const env = denyNetwork ? denyNetworkEnv(process.env) : process.env;

  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTruncated = false;
    const collect = (cur: string, chunk: Buffer): string => {
      if (cur.length + chunk.length > l.maxOutputBytes) {
        outputTruncated = true;
        child.kill("SIGKILL");
        return cur;
      }
      return cur + chunk.toString("utf8");
    };
    child.stdout.on("data", (c: Buffer) => (stdout = collect(stdout, c)));
    child.stderr.on("data", (c: Buffer) => (stderr = collect(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, l.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, outputTruncated });
    });
  });
}
