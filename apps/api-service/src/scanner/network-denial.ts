/**
 * Outbound network denial for repository analysis jobs.
 *
 * Two layers: (1) on Linux the job runs in a fresh network namespace
 * (`unshare --net`), so it has no interfaces beyond loopback; (2) proxy
 * variables are stripped/neutralised so tooling cannot be pointed at a proxy.
 * If namespace isolation is unavailable the wrapper fails closed.
 */

export class NetworkDenialUnavailableError extends Error {
  constructor(platform: string) {
    super(
      `Network isolation is not supported on platform "${platform}"; refusing to run job`,
    );
    this.name = "NetworkDenialUnavailableError";
  }
}

const PROXY_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
];

/** Returns a copy of env with proxy settings removed and NO_PROXY=*. */
export function denyNetworkEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const name of PROXY_VARS) delete out[name];
  out.NO_PROXY = "*";
  out.no_proxy = "*";
  return out;
}

/**
 * Wraps a command so it runs without network access.
 * Throws NetworkDenialUnavailableError on non-Linux platforms.
 * `platform` is injectable as a test hook.
 */
export function wrapWithNetworkDenial(
  command: string,
  args: string[],
  platform: string = process.platform,
): { command: string; args: string[] } {
  if (platform !== "linux") throw new NetworkDenialUnavailableError(platform);
  return {
    command: "unshare",
    args: ["--net", "--map-root-user", "--", command, ...args],
  };
}
