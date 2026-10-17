/**
 * Registry lookups for package maintainers.
 *
 * A provider answers one question for one ecosystem: who maintains this package,
 * and who published this version. Providers return raw data; normalization
 * (and the reduction of emails to domain digests) happens in the analyzer, so a
 * provider never needs to be trusted with privacy rules.
 *
 * Failure contract:
 * - Resolve `undefined` when the registry says the package does not exist.
 * - Throw `RegistryLookupError` with `transient: true` for timeouts, network
 *   errors, HTTP 429 and 5xx: the caller retries with backoff.
 * - Throw `RegistryLookupError` with `transient: false` for responses that will
 *   not improve on retry (malformed JSON, unexpected 4xx).
 * Any other thrown value is treated as transient.
 */

import type { RawPackageMaintainers } from "./maintainer-signal-analyzer";
import type { PackageRef } from "./maintainer-signal-types";

export interface MaintainerRegistryProvider {
  /** purl type this provider serves, e.g. `npm`. */
  readonly ecosystem: string;
  fetchMaintainers(
    ref: PackageRef,
    signal: AbortSignal,
  ): Promise<RawPackageMaintainers | undefined>;
}

export class RegistryLookupError extends Error {
  readonly transient: boolean;
  /** HTTP status when the failure came from a response. */
  readonly status?: number;

  constructor(message: string, transient: boolean, status?: number) {
    super(message);
    this.name = "RegistryLookupError";
    this.transient = transient;
    this.status = status;
  }
}

type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface HttpRegistryProviderOptions {
  /** Registry base URL without a trailing slash. */
  baseUrl?: string;
  /** Defaults to the global `fetch` (Node 18+). */
  fetchImpl?: FetchLike;
  /** Responses larger than this are rejected as invalid. */
  maxResponseBytes?: number;
  userAgent?: string;
}

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_USER_AGENT =
  "GasGuard-maintainer-signals (+https://github.com/MDTechLabs/GasGuard)";

abstract class HttpRegistryProvider implements MaintainerRegistryProvider {
  abstract readonly ecosystem: string;
  protected readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxResponseBytes: number;
  private readonly userAgent: string;

  constructor(defaultBaseUrl: string, options: HttpRegistryProviderOptions) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
    const fetchImpl =
      options.fetchImpl ??
      (globalThis.fetch as unknown as FetchLike | undefined);
    if (!fetchImpl) {
      throw new TypeError("fetch is unavailable; pass fetchImpl");
    }
    this.fetchImpl = fetchImpl;
    this.maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  abstract fetchMaintainers(
    ref: PackageRef,
    signal: AbortSignal,
  ): Promise<RawPackageMaintainers | undefined>;

  /** GET `url` as JSON; `undefined` on 404. */
  protected async getJson(
    url: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": this.userAgent },
        signal,
      });
    } catch {
      // Network failure or abort; the message deliberately omits the cause,
      // which can contain proxy URLs with credentials.
      throw new RegistryLookupError("Registry request failed", true);
    }
    if (response.status === 404) {
      return undefined;
    }
    if (response.status === 429 || response.status >= 500) {
      throw new RegistryLookupError(
        "Registry temporarily unavailable",
        true,
        response.status,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new RegistryLookupError(
        "Registry rejected the request",
        false,
        response.status,
      );
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw new RegistryLookupError("Registry response too large", false);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new RegistryLookupError("Registry response interrupted", true);
    }
    if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) {
      throw new RegistryLookupError("Registry response too large", false);
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new RegistryLookupError(
        "Registry response is not valid JSON",
        false,
      );
    }
  }
}

/**
 * npm registry. Reads the version manifest (`/<name>/<version>`, or
 * `/<name>/latest` without a version), which carries both `maintainers` and the
 * publishing account `_npmUser` and is far smaller than the full packument.
 */
export class NpmMaintainerProvider extends HttpRegistryProvider {
  readonly ecosystem = "npm";

  constructor(options: HttpRegistryProviderOptions = {}) {
    super("https://registry.npmjs.org", options);
  }

  async fetchMaintainers(
    ref: PackageRef,
    signal: AbortSignal,
  ): Promise<RawPackageMaintainers | undefined> {
    // Scoped names keep the leading `@`; the slash is encoded.
    const name = encodeURIComponent(ref.name).replace(/^%40/, "@");
    const tag = encodeURIComponent(ref.version ?? "latest");
    const manifest = await this.getJson(
      `${this.baseUrl}/${name}/${tag}`,
      signal,
    );
    if (!manifest) {
      return undefined;
    }
    if (!Array.isArray(manifest.maintainers)) {
      throw new RegistryLookupError("npm manifest has no maintainers", false);
    }
    const result: RawPackageMaintainers = {
      maintainers: manifest.maintainers.map((m) => {
        const entry = m as { name?: unknown; email?: unknown };
        return {
          handle: entry?.name as string,
          email: typeof entry?.email === "string" ? entry.email : undefined,
        };
      }),
    };
    const publisher = (manifest._npmUser as { name?: unknown } | undefined)
      ?.name;
    if (ref.version && typeof publisher === "string") {
      result.publisher = publisher;
    }
    return result;
  }
}

/**
 * crates.io. Owners come from `/api/v1/crates/<name>/owners`; when a version is
 * given, its `published_by` comes from `/api/v1/crates/<name>/<version>`.
 * crates.io does not expose owner emails, so domain-change signals never fire
 * for cargo packages.
 */
export class CratesIoMaintainerProvider extends HttpRegistryProvider {
  readonly ecosystem = "cargo";

  constructor(options: HttpRegistryProviderOptions = {}) {
    super("https://crates.io", options);
  }

  async fetchMaintainers(
    ref: PackageRef,
    signal: AbortSignal,
  ): Promise<RawPackageMaintainers | undefined> {
    const name = encodeURIComponent(ref.name);
    const owners = await this.getJson(
      `${this.baseUrl}/api/v1/crates/${name}/owners`,
      signal,
    );
    if (!owners) {
      return undefined;
    }
    if (!Array.isArray(owners.users)) {
      throw new RegistryLookupError("crates.io owners has no users", false);
    }
    const result: RawPackageMaintainers = {
      maintainers: owners.users.map((u) => ({
        handle: (u as { login?: unknown })?.login as string,
      })),
    };
    if (ref.version) {
      const version = await this.getJson(
        `${this.baseUrl}/api/v1/crates/${name}/${encodeURIComponent(ref.version)}`,
        signal,
      );
      const login = (
        version?.version as { published_by?: { login?: unknown } } | undefined
      )?.published_by?.login;
      if (typeof login === "string") {
        result.publisher = login;
      }
    }
    return result;
  }
}

/**
 * Fixed answers, for tests, air-gapped deployments, and replaying recorded
 * registry data. Keys are `name` (any version) or `name@version`.
 */
export class StaticMaintainerProvider implements MaintainerRegistryProvider {
  private readonly data: Map<string, RawPackageMaintainers>;

  constructor(
    readonly ecosystem: string,
    data: Record<string, RawPackageMaintainers> = {},
  ) {
    this.data = new Map(Object.entries(data));
  }

  set(key: string, value: RawPackageMaintainers | undefined): void {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }

  async fetchMaintainers(
    ref: PackageRef,
  ): Promise<RawPackageMaintainers | undefined> {
    const exact = ref.version
      ? this.data.get(`${ref.name}@${ref.version}`)
      : undefined;
    const value = exact ?? this.data.get(ref.name);
    return value === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(value)) as RawPackageMaintainers);
  }
}

/** The bundled providers for `BUILTIN_MAINTAINER_ECOSYSTEMS`. */
export function defaultMaintainerProviders(
  options: HttpRegistryProviderOptions = {},
): MaintainerRegistryProvider[] {
  return [
    new NpmMaintainerProvider({
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent,
      maxResponseBytes: options.maxResponseBytes,
    }),
    new CratesIoMaintainerProvider({
      fetchImpl: options.fetchImpl,
      userAgent: options.userAgent,
      maxResponseBytes: options.maxResponseBytes,
    }),
  ];
}
