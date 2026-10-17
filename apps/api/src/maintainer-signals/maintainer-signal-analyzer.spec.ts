import { readFileSync } from "fs";
import * as path from "path";
import { parseSbom } from "../sbom/sbom-parser";
import { resolveSbomIngestionConfig } from "../sbom/sbom-config";
import {
  InvalidMaintainerMetadataError,
  MaintainerBaseline,
  compareSignals,
  detectMaintainerChanges,
  emailDomainDigest,
  maintainersChanged,
  normalizeMaintainerSnapshot,
  normalizePackageRefs,
  packagesFromSbom,
  parsePurl,
} from "./maintainer-signal-analyzer";
import {
  MaintainerSignalError,
  PackageMaintainerSnapshot,
} from "./maintainer-signal-types";

const sbomFixture = (name: string) =>
  readFileSync(
    path.join(__dirname, "..", "sbom", "__fixtures__", name),
    "utf8",
  );

const baseline = (
  maintainers: Array<[string, string?]>,
): MaintainerBaseline => ({
  ecosystem: "npm",
  package: "left-pad",
  observedAt: 1_000,
  revision: 1,
  maintainers: maintainers.map(([handle, domain]) =>
    domain
      ? { handle, emailDomainDigest: emailDomainDigest(`x@${domain}`) }
      : { handle },
  ),
});

const snapshot = (
  maintainers: Array<[string, string?]>,
  publisher?: string,
): PackageMaintainerSnapshot =>
  normalizeMaintainerSnapshot(
    {
      maintainers: maintainers.map(([handle, domain]) => ({
        handle,
        email: domain ? `x@${domain}` : undefined,
      })),
      publisher,
    },
    100,
  );

const REF = { ecosystem: "npm", name: "left-pad", version: "1.3.0" };

describe("normalizePackageRefs", () => {
  it("normalizes, de-duplicates, and sorts deterministically", () => {
    const refs = normalizePackageRefs([
      { ecosystem: "NPM", name: " lodash ", version: "4.17.21" },
      { ecosystem: "cargo", name: "serde" },
      { ecosystem: "npm", name: "lodash", version: "4.17.20" },
    ]);
    expect(refs).toEqual([
      { ecosystem: "cargo", name: "serde" },
      { ecosystem: "npm", name: "lodash", version: "4.17.20" },
    ]);
    // Input order does not change the result.
    expect(
      normalizePackageRefs([
        { ecosystem: "npm", name: "lodash", version: "4.17.20" },
        { ecosystem: "cargo", name: "serde" },
        { ecosystem: "npm", name: "lodash", version: "4.17.21" },
      ]),
    ).toEqual(refs);
  });

  it("accepts an empty list", () => {
    expect(normalizePackageRefs([])).toEqual([]);
  });

  it.each([
    ["not an array", "lodash"],
    ["missing name", [{ ecosystem: "npm" }]],
    ["bad ecosystem", [{ ecosystem: "n p m", name: "x" }]],
    ["whitespace in name", [{ ecosystem: "npm", name: "a b" }]],
    ["control char", [{ ecosystem: "npm", name: "a\u0000" }]],
    ["name too long", [{ ecosystem: "npm", name: "a".repeat(215) }]],
    ["non-string version", [{ ecosystem: "npm", name: "a", version: 1 }]],
    ["null entry", [null]],
  ])("rejects %s", (_label, input) => {
    expect(() => normalizePackageRefs(input)).toThrow(MaintainerSignalError);
  });
});

describe("parsePurl", () => {
  it.each([
    [
      "pkg:npm/lodash@4.17.21",
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
    ],
    [
      "pkg:npm/%40openzeppelin/contracts@5.0.2",
      { ecosystem: "npm", name: "@openzeppelin/contracts", version: "5.0.2" },
    ],
    [
      "pkg:cargo/soroban-sdk@21.0.0?repository_url=https%3A%2F%2Fx",
      { ecosystem: "cargo", name: "soroban-sdk", version: "21.0.0" },
    ],
    ["pkg:npm/no-version", { ecosystem: "npm", name: "no-version" }],
  ])("parses %s", (purl, expected) => {
    expect(parsePurl(purl)).toEqual(expected);
  });

  it.each(["", "npm/lodash", "pkg:npm/", "pkg:npm/%E0%A4%A"])(
    "returns undefined for %j",
    (purl) => expect(parsePurl(purl)).toBeUndefined(),
  );
});

describe("packagesFromSbom", () => {
  it("derives packages from a CycloneDX SBOM", () => {
    const sbom = parseSbom(
      sbomFixture("cyclonedx-1.5.json"),
      // The fixture deliberately includes one invalid component.
      resolveSbomIngestionConfig({ maxRejectedRatio: 0.5 }),
    );
    expect(packagesFromSbom(sbom)).toEqual([
      { ecosystem: "cargo", name: "soroban-sdk", version: "21.0.0" },
      { ecosystem: "npm", name: "@openzeppelin/contracts", version: "5.0.2" },
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
    ]);
  });

  it("derives packages from an SPDX SBOM", () => {
    const sbom = parseSbom(
      sbomFixture("spdx-2.3.json"),
      resolveSbomIngestionConfig(),
    );
    expect(packagesFromSbom(sbom).map((p) => p.name)).toEqual([
      "serde",
      "ethers",
    ]);
  });
});

describe("normalizeMaintainerSnapshot", () => {
  it("normalizes handles, merges duplicates, and never keeps emails", () => {
    const result = normalizeMaintainerSnapshot(
      {
        maintainers: [
          { handle: " Alice ", email: "alice@Example.COM" },
          { handle: "bob" },
          { handle: "alice", email: "alice@other.org" },
          { handle: "" },
          { handle: 42 as unknown as string },
        ],
        publisher: "BOB",
      },
      10,
    );
    expect(result.maintainers.map((m) => m.handle)).toEqual(["alice", "bob"]);
    expect(result.publisher).toBe("bob");
    expect(JSON.stringify(result)).not.toMatch(/@|example|other\.org/i);
    const digests = [
      emailDomainDigest("x@example.com"),
      emailDomainDigest("x@other.org"),
    ];
    expect(digests).toContain(result.maintainers[0].emailDomainDigest);
    expect(result.maintainers[0].emailDomainDigest).toBe(
      [...digests].sort()[0],
    );
  });

  it("is case-insensitive for email domains", () => {
    expect(emailDomainDigest("a@EXAMPLE.com")).toBe(
      emailDomainDigest("b@example.com"),
    );
    expect(emailDomainDigest("no-at-sign")).toBeUndefined();
    expect(emailDomainDigest("a@")).toBeUndefined();
  });

  it.each([null, {}, { maintainers: "x" }])("rejects %j", (raw) => {
    expect(() => normalizeMaintainerSnapshot(raw, 10)).toThrow(
      InvalidMaintainerMetadataError,
    );
  });

  it("enforces maxMaintainers at the boundary", () => {
    const raw = { maintainers: [{ handle: "a" }, { handle: "b" }] };
    expect(normalizeMaintainerSnapshot(raw, 2).maintainers).toHaveLength(2);
    expect(() => normalizeMaintainerSnapshot(raw, 1)).toThrow(
      InvalidMaintainerMetadataError,
    );
  });
});

describe("detectMaintainerChanges", () => {
  it("emits nothing without a baseline", () => {
    expect(
      detectMaintainerChanges(REF, undefined, snapshot([["a"]], "z")),
    ).toEqual([]);
  });

  it("emits nothing when nothing changed", () => {
    const signals = detectMaintainerChanges(
      REF,
      baseline([["a", "x.com"], ["b"]]),
      snapshot([["b"], ["a", "x.com"]], "a"),
    );
    expect(signals).toEqual([]);
  });

  it("reports added and removed maintainers", () => {
    const signals = detectMaintainerChanges(
      REF,
      baseline([["a"], ["b"]]),
      snapshot([["a"], ["c"], ["d"]]),
    );
    expect(signals.map((s) => [s.type, s.severity, s.handles])).toEqual([
      ["MAINTAINER_ADDED", "low", ["c", "d"]],
      ["MAINTAINER_REMOVED", "low", ["b"]],
    ]);
    expect(signals[0]).toMatchObject({
      ecosystem: "npm",
      package: "left-pad",
      version: "1.3.0",
      baselineObservedAt: 1_000,
    });
  });

  it("reports a full ownership transfer instead of add/remove", () => {
    const signals = detectMaintainerChanges(
      REF,
      baseline([["a"], ["b"]]),
      snapshot([["mallory"]], "mallory"),
    );
    expect(signals.map((s) => [s.type, s.severity, s.handles])).toEqual([
      ["OWNERSHIP_TRANSFERRED", "high", ["mallory"]],
      ["PUBLISHED_BY_NEW_MAINTAINER", "medium", ["mallory"]],
    ]);
  });

  it("treats losing every maintainer as removal, not transfer", () => {
    const signals = detectMaintainerChanges(
      REF,
      baseline([["a"]]),
      snapshot([]),
    );
    expect(signals.map((s) => s.type)).toEqual(["MAINTAINER_REMOVED"]);
  });

  it("reports an email domain change only when both sides have a domain", () => {
    const signals = detectMaintainerChanges(
      REF,
      baseline([["a", "old.com"], ["b", "b.com"], ["c"]]),
      snapshot([["a", "new.com"], ["b"], ["c", "c.com"]]),
    );
    expect(signals.map((s) => [s.type, s.handles])).toEqual([
      ["MAINTAINER_EMAIL_DOMAIN_CHANGED", ["a"]],
    ]);
    expect(JSON.stringify(signals)).not.toMatch(/old\.com|new\.com/);
  });

  it("checks the publisher only when a version is known", () => {
    const current = snapshot([["a"], ["newbie"]], "newbie");
    const withVersion = detectMaintainerChanges(
      REF,
      baseline([["a"]]),
      current,
    );
    expect(withVersion.map((s) => s.type)).toContain(
      "PUBLISHED_BY_NEW_MAINTAINER",
    );
    const withoutVersion = detectMaintainerChanges(
      { ecosystem: "npm", name: "left-pad" },
      baseline([["a"]]),
      current,
    );
    expect(withoutVersion.map((s) => s.type)).toEqual(["MAINTAINER_ADDED"]);
  });

  it("honours severity overrides", () => {
    const [signal] = detectMaintainerChanges(
      REF,
      baseline([["a"]]),
      snapshot([["a"], ["b"]]),
      { MAINTAINER_ADDED: "high" },
    );
    expect(signal.severity).toBe("high");
  });
});

describe("maintainersChanged and compareSignals", () => {
  it("detects set and digest differences", () => {
    expect(maintainersChanged(undefined, snapshot([["a"]]))).toBe(false);
    expect(maintainersChanged(baseline([["a"]]), snapshot([["a"]]))).toBe(
      false,
    );
    expect(maintainersChanged(baseline([["a"]]), snapshot([["b"]]))).toBe(true);
    expect(
      maintainersChanged(
        baseline([["a", "x.com"]]),
        snapshot([["a", "y.com"]]),
      ),
    ).toBe(true);
  });

  it("orders by severity, then package identity", () => {
    const signals = [
      ...detectMaintainerChanges(
        { ecosystem: "npm", name: "b" },
        { ...baseline([["a"]]), package: "b" },
        snapshot([["a"], ["x"]]),
      ),
      ...detectMaintainerChanges(
        { ecosystem: "npm", name: "a" },
        { ...baseline([["a"]]), package: "a" },
        snapshot([["z"]]),
      ),
    ].sort(compareSignals);
    expect(signals.map((s) => `${s.severity}:${s.package}`)).toEqual([
      "high:a",
      "low:b",
    ]);
  });
});
