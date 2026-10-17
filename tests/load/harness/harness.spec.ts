import { Rng } from "./prng";
import { EventScheduler } from "./scheduler";
import { percentile, summarize } from "./stats";
import { validateSimulationConfig } from "../scan-pipeline.simulator";
import { buildScenario } from "../scenarios";

describe("Rng", () => {
  it("is reproducible from its seed and differs between seeds", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
  });

  it("keeps next() within [0, 1) and int() within its inclusive bounds", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 2_000; i += 1) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(rng.int(9, 9)).toBe(9);
  });

  it("handles the probability boundaries exactly", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 200; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("produces an exponential distribution with roughly the requested mean", () => {
    const rng = new Rng(99);
    const n = 20_000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += rng.exponential(100);
    expect(sum / n).toBeGreaterThan(90);
    expect(sum / n).toBeLessThan(110);
  });

  it("forks independent, reproducible streams", () => {
    const root = new Rng(5);
    const a1 = root.fork("a");
    root.next(); // drawing from the parent must not disturb a fork
    const a2 = new Rng(5).fork("a");
    expect(a1.next()).toBe(a2.next());
    expect(new Rng(5).fork("a").next()).not.toBe(new Rng(5).fork("b").next());
  });

  it("rejects invalid arguments", () => {
    expect(() => new Rng(1.5)).toThrow(TypeError);
    const rng = new Rng(1);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
    expect(() => rng.chance(1.01)).toThrow(RangeError);
    expect(() => rng.chance(Number.NaN)).toThrow(RangeError);
    expect(() => rng.exponential(0)).toThrow(RangeError);
    expect(() => rng.exponential(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("EventScheduler", () => {
  it("runs events in time order, and in scheduling order at the same instant", () => {
    const s = new EventScheduler();
    const order: string[] = [];
    s.schedule(30, () => order.push("c"));
    s.schedule(10, () => order.push("a1"));
    s.schedule(10, () => order.push("a2"));
    s.schedule(20, () => order.push("b"));
    while (s.step());
    expect(order).toEqual(["a1", "a2", "b", "c"]);
    expect(s.now).toBe(30);
    expect(s.processed).toBe(4);
  });

  it("lets events schedule further events", () => {
    const s = new EventScheduler();
    const seen: number[] = [];
    s.schedule(5, () => {
      seen.push(s.now);
      s.after(10, () => seen.push(s.now));
    });
    while (s.step());
    expect(seen).toEqual([5, 15]);
  });

  it("stays correctly ordered across many events", () => {
    const s = new EventScheduler();
    const rng = new Rng(3);
    const times: number[] = [];
    for (let i = 0; i < 5_000; i += 1) {
      const at = rng.int(0, 10_000);
      s.schedule(at, () => times.push(s.now));
    }
    while (s.step());
    expect(times).toHaveLength(5_000);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it("returns false when empty and rejects bad times", () => {
    const s = new EventScheduler();
    expect(s.step()).toBe(false);
    s.schedule(10, () => undefined);
    s.step();
    expect(() => s.schedule(5, () => undefined)).toThrow(RangeError);
    expect(() => s.schedule(Number.NaN, () => undefined)).toThrow(TypeError);
  });
});

describe("stats", () => {
  it("uses nearest-rank percentiles with correct boundaries", () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(data, 0)).toBe(1);
    expect(percentile(data, 50)).toBe(5);
    expect(percentile(data, 95)).toBe(10);
    expect(percentile(data, 100)).toBe(10);
    expect(percentile([42], 99)).toBe(42);
    expect(percentile([], 50)).toBe(0);
    expect(() => percentile(data, 101)).toThrow(RangeError);
    expect(() => percentile(data, -1)).toThrow(RangeError);
  });

  it("summarizes unsorted samples and handles the empty case", () => {
    expect(summarize([30, 10, 20])).toEqual({ count: 3, min: 10, mean: 20, p50: 20, p95: 30, p99: 30, max: 30 });
    expect(summarize([])).toEqual({ count: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
    expect(() => summarize([1, Number.NaN])).toThrow(TypeError);
  });
});

describe("validateSimulationConfig", () => {
  const valid = () => buildScenario("steady");

  it("accepts every built-in scenario", () => {
    for (const name of ["steady", "burst", "noisy-neighbor", "worker-crash", "duplicate-storm", "flaky-poison", "chaos"] as const) {
      expect(() => validateSimulationConfig(buildScenario(name))).not.toThrow();
    }
  });

  it("rejects configs that would make results meaningless", () => {
    const cases: Array<(c: ReturnType<typeof valid>) => void> = [
      (c) => { c.workers = 0; },
      (c) => { c.service.maxMs = c.service.minMs - 1; },
      (c) => { c.service.checkpointEvery = c.service.items + 1; },
      (c) => { c.leaseTtlMs = 100; }, // shorter than two item durations
      (c) => { c.faults.crashRate = 0.6; c.faults.stallRate = 0.6; },
      (c) => { c.faults.failRate = -0.1; },
      (c) => { c.faults.stallMs = c.leaseTtlMs; },
      (c) => { c.retry.multiplier = 0.5; },
      (c) => { c.tenants = []; },
      (c) => { c.tenants.push({ ...c.tenants[0] }); },
    ];
    for (const mutate of cases) {
      const config = valid();
      mutate(config);
      expect(() => validateSimulationConfig(config)).toThrow(RangeError);
    }
  });

  it("rejects an invalid scenario scale", () => {
    expect(() => buildScenario("steady", 1, 0)).toThrow(RangeError);
    expect(() => buildScenario("steady", 1, 101)).toThrow(RangeError);
    expect(() => buildScenario("steady", 1, 1.5)).toThrow(RangeError);
  });
});
