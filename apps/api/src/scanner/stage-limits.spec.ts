import { StageLimitError, runWithStageLimits } from "./stage-limits";

describe("runWithStageLimits (#1347)", () => {
  it("returns the stage result when within limits", async () => {
    await expect(runWithStageLimits("parse", async () => 42)).resolves.toBe(42);
  });

  it("rejects a stage that exceeds the wall-clock limit", async () => {
    const slow = () => new Promise((resolve) => setTimeout(resolve, 200));
    await expect(runWithStageLimits("parse", slow, { wallClockMs: 20 })).rejects.toMatchObject({
      name: "StageLimitError",
      kind: "wall_clock",
    });
  });

  it("rejects a stage that exceeds the CPU budget", async () => {
    const busy = async () => {
      const end = Date.now() + 50;
      while (Date.now() < end) {
        /* spin */
      }
    };
    await expect(runWithStageLimits("analyze", busy, { cpuMs: 5 })).rejects.toBeInstanceOf(StageLimitError);
  });

  it("rejects invalid limits", async () => {
    await expect(runWithStageLimits("x", async () => 1, { cpuMs: 0 })).rejects.toThrow(RangeError);
  });
});
