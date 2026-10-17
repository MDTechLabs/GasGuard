import { readFileSync } from "fs";
import * as path from "path";
import {
  CratesIoMaintainerProvider,
  NpmMaintainerProvider,
  RegistryLookupError,
  StaticMaintainerProvider,
  defaultMaintainerProviders,
} from "./maintainer-registry-provider";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

interface FakeResponse {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

/** Fetch stand-in serving canned responses by URL and recording requests. */
function fakeFetch(routes: Record<string, FakeResponse | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = async (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => {
    calls.push({ url, headers: init.headers });
    const route = routes[url] ?? { status: 404, body: "{}" };
    if (route instanceof Error) {
      throw route;
    }
    return {
      status: route.status,
      headers: {
        get: (name: string) => route.headers?.[name.toLowerCase()] ?? null,
      },
      text: async () => route.body ?? "",
    };
  };
  return { impl, calls };
}

const signal = new AbortController().signal;

describe("NpmMaintainerProvider", () => {
  it("reads maintainers and publisher from the version manifest", async () => {
    const { impl, calls } = fakeFetch({
      "https://registry.npmjs.org/lodash/4.17.21": {
        status: 200,
        body: fixture("npm-lodash-4.17.21.json"),
      },
    });
    const provider = new NpmMaintainerProvider({ fetchImpl: impl });
    const result = await provider.fetchMaintainers(
      { ecosystem: "npm", name: "lodash", version: "4.17.21" },
      signal,
    );
    expect(result?.maintainers.map((m) => m.handle)).toEqual([
      "mathias",
      "jdalton",
      "bnjmnt4n",
    ]);
    expect(result?.publisher).toBe("bnjmnt4n");
    expect(calls[0].headers["user-agent"]).toMatch(/GasGuard/);
  });

  it("encodes scoped names and uses latest without a version", async () => {
    const { impl, calls } = fakeFetch({
      "https://registry.npmjs.org/@openzeppelin%2Fcontracts/latest": {
        status: 200,
        body: fixture("npm-openzeppelin-contracts-5.0.2.json"),
      },
    });
    const result = await new NpmMaintainerProvider({
      fetchImpl: impl,
    }).fetchMaintainers(
      { ecosystem: "npm", name: "@openzeppelin/contracts" },
      signal,
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://registry.npmjs.org/@openzeppelin%2Fcontracts/latest",
    ]);
    expect(result?.maintainers).toHaveLength(2);
    // Publisher is only meaningful for a pinned version.
    expect(result?.publisher).toBeUndefined();
  });

  it("returns undefined for 404", async () => {
    const { impl } = fakeFetch({});
    await expect(
      new NpmMaintainerProvider({ fetchImpl: impl }).fetchMaintainers(
        { ecosystem: "npm", name: "nope" },
        signal,
      ),
    ).resolves.toBeUndefined();
  });

  it.each<[string, FakeResponse | Error, boolean]>([
    ["429", { status: 429 }, true],
    ["503", { status: 503 }, true],
    ["network error", new Error("connect ECONNREFUSED http://u:p@proxy"), true],
    ["403", { status: 403 }, false],
    ["invalid JSON", { status: 200, body: "<html>" }, false],
    ["JSON array", { status: 200, body: "[]" }, false],
    ["no maintainers", { status: 200, body: "{}" }, false],
    [
      "oversized by header",
      { status: 200, body: "{}", headers: { "content-length": "999999999" } },
      false,
    ],
  ])("classifies %s", async (_label, response, transient) => {
    const { impl } = fakeFetch({
      "https://registry.npmjs.org/x/latest": response,
    });
    const error = await new NpmMaintainerProvider({ fetchImpl: impl })
      .fetchMaintainers({ ecosystem: "npm", name: "x" }, signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistryLookupError);
    expect((error as RegistryLookupError).transient).toBe(transient);
    // Messages are fixed strings and never echo the underlying cause.
    expect((error as Error).message).not.toMatch(/u:p|proxy|html/);
  });

  it("rejects bodies larger than maxResponseBytes", async () => {
    const { impl } = fakeFetch({
      "https://registry.npmjs.org/x/latest": {
        status: 200,
        body: JSON.stringify({ maintainers: [], pad: "x".repeat(100) }),
      },
    });
    await expect(
      new NpmMaintainerProvider({
        fetchImpl: impl,
        maxResponseBytes: 50,
      }).fetchMaintainers({ ecosystem: "npm", name: "x" }, signal),
    ).rejects.toMatchObject({ transient: false });
  });

  it("honours a custom base URL", async () => {
    const { impl, calls } = fakeFetch({});
    await new NpmMaintainerProvider({
      fetchImpl: impl,
      baseUrl: "https://npm.internal.example/",
    }).fetchMaintainers({ ecosystem: "npm", name: "x" }, signal);
    expect(calls[0].url).toBe("https://npm.internal.example/x/latest");
  });
});

describe("CratesIoMaintainerProvider", () => {
  it("reads owners and the version publisher", async () => {
    const { impl, calls } = fakeFetch({
      "https://crates.io/api/v1/crates/soroban-sdk/owners": {
        status: 200,
        body: fixture("crates-soroban-sdk-owners.json"),
      },
      "https://crates.io/api/v1/crates/soroban-sdk/21.0.0": {
        status: 200,
        body: fixture("crates-soroban-sdk-21.0.0.json"),
      },
    });
    const result = await new CratesIoMaintainerProvider({
      fetchImpl: impl,
    }).fetchMaintainers(
      { ecosystem: "cargo", name: "soroban-sdk", version: "21.0.0" },
      signal,
    );
    expect(result).toEqual({
      maintainers: [
        { handle: "leighmcculloch" },
        { handle: "github:stellar:core" },
      ],
      publisher: "leighmcculloch",
    });
    expect(calls).toHaveLength(2);
  });

  it("skips the version request without a version", async () => {
    const { impl, calls } = fakeFetch({
      "https://crates.io/api/v1/crates/serde/owners": {
        status: 200,
        body: '{"users":[{"login":"dtolnay"}]}',
      },
    });
    const result = await new CratesIoMaintainerProvider({
      fetchImpl: impl,
    }).fetchMaintainers({ ecosystem: "cargo", name: "serde" }, signal);
    expect(result?.publisher).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("treats a malformed owners body as invalid", async () => {
    const { impl } = fakeFetch({
      "https://crates.io/api/v1/crates/x/owners": { status: 200, body: "{}" },
    });
    await expect(
      new CratesIoMaintainerProvider({ fetchImpl: impl }).fetchMaintainers(
        { ecosystem: "cargo", name: "x" },
        signal,
      ),
    ).rejects.toMatchObject({ transient: false });
  });
});

describe("StaticMaintainerProvider", () => {
  it("prefers an exact version entry and returns copies", async () => {
    const provider = new StaticMaintainerProvider("npm", {
      a: { maintainers: [{ handle: "any" }] },
      "a@1.0.0": { maintainers: [{ handle: "exact" }] },
    });
    const exact = await provider.fetchMaintainers({
      ecosystem: "npm",
      name: "a",
      version: "1.0.0",
    });
    expect(exact?.maintainers[0].handle).toBe("exact");
    exact!.maintainers[0].handle = "mutated";
    const again = await provider.fetchMaintainers({
      ecosystem: "npm",
      name: "a",
      version: "1.0.0",
    });
    expect(again?.maintainers[0].handle).toBe("exact");
    expect(
      (await provider.fetchMaintainers({ ecosystem: "npm", name: "a" }))
        ?.maintainers[0].handle,
    ).toBe("any");
    provider.set("a", undefined);
    expect(
      await provider.fetchMaintainers({ ecosystem: "npm", name: "a" }),
    ).toBeUndefined();
  });
});

it("defaultMaintainerProviders covers the built-in ecosystems", () => {
  const { impl } = fakeFetch({});
  expect(
    defaultMaintainerProviders({ fetchImpl: impl }).map((p) => p.ecosystem),
  ).toEqual(["npm", "cargo"]);
});
