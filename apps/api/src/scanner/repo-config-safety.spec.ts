import {
  UnsafeRepositoryConfigError,
  isExecutableConfigFile,
  parseRepositoryConfig,
} from "./repo-config-safety";

describe("parseRepositoryConfig (#1348)", () => {
  it("parses plain JSON config", () => {
    expect(parseRepositoryConfig("gasguard.json", '{"rules":["a"]}')).toEqual({ rules: ["a"] });
  });

  it("refuses executable config files", () => {
    expect(isExecutableConfigFile("hardhat.config.ts")).toBe(true);
    expect(() => parseRepositoryConfig("hardhat.config.js", "{}")).toThrow(UnsafeRepositoryConfigError);
  });

  it("rejects oversized, deep and non-JSON input", () => {
    expect(() => parseRepositoryConfig("a.json", "{}", { maxBytes: 1 })).toThrow(UnsafeRepositoryConfigError);
    expect(() => parseRepositoryConfig("a.json", '{"a":{"b":{}}}', { maxDepth: 2 })).toThrow(UnsafeRepositoryConfigError);
    expect(() => parseRepositoryConfig("a.json", "module.exports = {}")).toThrow(UnsafeRepositoryConfigError);
  });

  it("rejects prototype-polluting keys", () => {
    expect(() => parseRepositoryConfig("a.json", '{"__proto__":{"x":1}}')).toThrow(UnsafeRepositoryConfigError);
  });
});
