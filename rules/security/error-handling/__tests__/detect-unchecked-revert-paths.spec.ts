import { detectUncheckedRevertPaths } from "../detect-unchecked-revert-paths";

describe("detectUncheckedRevertPaths", () => {
  it("flags assert on a caller-supplied parameter with a precise location", () => {
    const source = `
contract Vault {
    function withdraw(uint256 amount) external {
        assert(amount <= 10 ether);
    }
}`;
    const result = detectUncheckedRevertPaths(source);
    expect(result.findings[0]).toMatchObject({
      ruleId: "unchecked-revert-paths",
      title: "assert used for caller-controlled input",
      line: 4,
      severity: "medium",
    });
  });

  it("accepts require validation and assertions on local invariant values", () => {
    const source = `
contract Vault {
    function withdraw(uint256 amount) external {
        require(amount <= 10 ether);
        uint256 invariantValue = amount;
        assert(invariantValue <= 10 ether);
    }
}`;
    expect(detectUncheckedRevertPaths(source).findings).toEqual([]);
  });

  it("flags empty and logging-only catch branches that swallow reverts", () => {
    const source = `
interface ITarget { function run() external; }
contract Caller {
    event Failed();
    function run(ITarget target, bool logOnly) external {
        if (logOnly) {
            try target.run() { } catch { emit Failed(); }
        } else {
            try target.run() { } catch { }
        }
    }
}`;
    const result = detectUncheckedRevertPaths(source);
    expect(result.findings.map((finding) => [finding.title, finding.severity])).toEqual([
      ["Caught external revert is silently accepted", "low"],
      ["Caught external revert is silently accepted", "medium"],
    ]);
  });

  it("does not report catches that propagate failure or return an explicit result", () => {
    const source = `
interface ITarget { function run() external; }
contract Caller {
    function run(ITarget target) external {
        try target.run() { } catch (bytes memory reason) { assembly { revert(add(reason, 32), mload(reason)) } }
        try target.run() { } catch { return; }
    }
}`;
    expect(detectUncheckedRevertPaths(source).findings).toEqual([]);
  });

  it("fails safely on malformed Solidity", () => {
    const result = detectUncheckedRevertPaths("contract Broken {");
    expect(result.findings).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.level === "error")).toBe(true);
  });
});
