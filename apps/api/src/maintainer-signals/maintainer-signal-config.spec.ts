import {
  DEFAULT_MAINTAINER_SIGNAL_CONFIG,
  loadMaintainerSignalConfigFromEnv,
  resolveMaintainerSignalConfig,
} from "./maintainer-signal-config";

describe("resolveMaintainerSignalConfig", () => {
  it("returns validated defaults", () => {
    const config = resolveMaintainerSignalConfig();
    expect(config).toEqual(DEFAULT_MAINTAINER_SIGNAL_CONFIG);
    expect(config.supportedEcosystems).toEqual(["cargo", "npm"]);
  });

  it("ignores undefined overrides", () => {
    expect(
      resolveMaintainerSignalConfig({ maxAttempts: undefined }).maxAttempts,
    ).toBe(DEFAULT_MAINTAINER_SIGNAL_CONFIG.maxAttempts);
  });

  it("de-duplicates and sorts ecosystems", () => {
    expect(
      resolveMaintainerSignalConfig({
        supportedEcosystems: ["npm", "cargo", "npm"],
      }).supportedEcosystems,
    ).toEqual(["cargo", "npm"]);
  });

  it.each([
    [{ enabled: "yes" as unknown as boolean }, "enabled"],
    [{ supportedEcosystems: ["NPM"] }, "supportedEcosystems"],
    [
      { supportedEcosystems: "npm" as unknown as string[] },
      "supportedEcosystems",
    ],
    [{ minSeverity: "critical" as never }, "minSeverity"],
    [{ maxPackagesPerScan: 0 }, "maxPackagesPerScan"],
    [{ lookupConcurrency: 1.5 }, "lookupConcurrency"],
    [{ lookupTimeoutMs: -1 }, "lookupTimeoutMs"],
    [{ lookupRetryBackoffMs: -1 }, "lookupRetryBackoffMs"],
    [{ maxFailedLookupRatio: 1.1 }, "maxFailedLookupRatio"],
    [{ maxFailedLookupRatio: Number.NaN }, "maxFailedLookupRatio"],
    [{ retryBackoffMs: 10, maxRetryBackoffMs: 5 }, "maxRetryBackoffMs"],
    [
      { maxPendingJobs: 5, maxPendingJobsPerTenant: 6 },
      "maxPendingJobsPerTenant",
    ],
  ])("rejects %j", (overrides, field) => {
    expect(() => resolveMaintainerSignalConfig(overrides)).toThrow(
      new RegExp(field),
    );
  });

  it("accepts boundary values", () => {
    const config = resolveMaintainerSignalConfig({
      maxFailedLookupRatio: 0,
      maxReportedSkips: 0,
      lookupRetryBackoffMs: 0,
      supportedEcosystems: [],
      minSeverity: "info",
    });
    expect(config.maxFailedLookupRatio).toBe(0);
    expect(config.supportedEcosystems).toEqual([]);
  });
});

describe("loadMaintainerSignalConfigFromEnv", () => {
  it("keeps defaults for unset or blank variables", () => {
    expect(
      loadMaintainerSignalConfigFromEnv({
        MAINTAINER_SIGNALS_MAX_ATTEMPTS: " ",
      }),
    ).toEqual(DEFAULT_MAINTAINER_SIGNAL_CONFIG);
  });

  it("parses every kind of value", () => {
    const config = loadMaintainerSignalConfigFromEnv({
      MAINTAINER_SIGNALS_ENABLED: "off",
      MAINTAINER_SIGNALS_ECOSYSTEMS: " NPM , pypi ,",
      MAINTAINER_SIGNALS_MIN_SEVERITY: "HIGH",
      MAINTAINER_SIGNALS_MAX_PACKAGES: "10",
      MAINTAINER_SIGNALS_MAX_FAILED_LOOKUP_RATIO: "0.5",
    });
    expect(config.enabled).toBe(false);
    expect(config.supportedEcosystems).toEqual(["npm", "pypi"]);
    expect(config.minSeverity).toBe("high");
    expect(config.maxPackagesPerScan).toBe(10);
    expect(config.maxFailedLookupRatio).toBe(0.5);
  });

  it.each([
    ["MAINTAINER_SIGNALS_ENABLED", "maybe"],
    ["MAINTAINER_SIGNALS_MAX_PACKAGES", "ten"],
    ["MAINTAINER_SIGNALS_MIN_SEVERITY", "urgent"],
  ])("fails fast on %s=%s", (key, value) => {
    expect(() => loadMaintainerSignalConfigFromEnv({ [key]: value })).toThrow(
      RangeError,
    );
  });
});
