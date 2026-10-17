import {
  DEFAULT_PRIORITY_QUEUE_CONFIG,
  JOB_PRIORITIES,
  JobPriority,
  JobPriorityQueue,
  isJobPriority,
  resolveJobPriority,
  toBullMqPriority,
} from "./priority-queue";

function drain<T>(queue: JobPriorityQueue<T>, now: number): string[] {
  const out: string[] = [];
  for (let job = queue.dequeue(now); job; job = queue.dequeue(now)) {
    out.push(job.id);
  }
  return out;
}

describe("JobPriorityQueue ordering", () => {
  it("runs higher priorities first regardless of arrival order", () => {
    const queue = new JobPriorityQueue<string>();
    queue.enqueue("low-1", "x", { priority: "low" }, 0);
    queue.enqueue("normal-1", "x", { priority: "normal" }, 0);
    queue.enqueue("critical-1", "x", { priority: "critical" }, 0);
    queue.enqueue("high-1", "x", { priority: "high" }, 0);

    expect(drain(queue, 0)).toEqual(["critical-1", "high-1", "normal-1", "low-1"]);
  });

  it("is first-in first-out within a priority", () => {
    const queue = new JobPriorityQueue<number>();
    for (let i = 0; i < 5; i += 1) queue.enqueue(`job-${i}`, i, { priority: "high" }, i);

    expect(drain(queue, 5)).toEqual(["job-0", "job-1", "job-2", "job-3", "job-4"]);
  });

  it("defaults to normal priority", () => {
    const queue = new JobPriorityQueue<string>();
    expect(queue.enqueue("a", "x", {}, 0)).toEqual({ accepted: true, priority: "normal" });
    expect(queue.enqueue("b", "x", undefined, 0)).toEqual({ accepted: true, priority: "normal" });
    queue.enqueue("c", "x", { priority: "high" }, 0);
    expect(drain(queue, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns the payload and timing, and undefined when empty", () => {
    const queue = new JobPriorityQueue<{ repo: string }>();
    expect(queue.dequeue(0)).toBeUndefined();
    expect(queue.peek(0)).toBeUndefined();

    queue.enqueue("a", { repo: "r1" }, { priority: "low" }, 1_000);
    expect(queue.dequeue(1_500)).toEqual({
      id: "a",
      payload: { repo: "r1" },
      priority: "low",
      effectivePriority: "low",
      enqueuedAt: 1_000,
      waitedMs: 500,
    });
    expect(queue.dequeue(1_500)).toBeUndefined();
  });

  it("peek does not remove or reorder anything", () => {
    const queue = new JobPriorityQueue<string>();
    queue.enqueue("a", "x", { priority: "low" }, 0);
    queue.enqueue("b", "x", { priority: "high" }, 0);

    expect(queue.peek(0)?.id).toBe("b");
    expect(queue.peek(0)?.id).toBe("b");
    expect(queue.size()).toBe(2);
    expect(drain(queue, 0)).toEqual(["b", "a"]);
  });

  it("orders deterministically for a large mixed workload", () => {
    const queue = new JobPriorityQueue<number>({ agingMs: Number.MAX_SAFE_INTEGER });
    const order: JobPriority[] = ["low", "high", "normal", "critical"];
    for (let i = 0; i < 1_000; i += 1) {
      queue.enqueue(`job-${i}`, i, { priority: order[i % 4] }, i);
    }

    const out = drain(queue, 1_000);
    expect(out).toHaveLength(1_000);
    // critical (i % 4 === 3) first, then high (1), normal (2), low (0), each in arrival order
    const expected = [3, 1, 2, 0].flatMap((m) =>
      Array.from({ length: 250 }, (_, k) => `job-${k * 4 + m}`),
    );
    expect(out).toEqual(expected);
  });
});

describe("JobPriorityQueue aging", () => {
  const config = { agingMs: 1_000 };

  it("does not promote before the aging interval and promotes exactly at it", () => {
    const queue = new JobPriorityQueue<string>(config);
    queue.enqueue("old-normal", "x", { priority: "normal" }, 0);
    queue.enqueue("new-high", "x", { priority: "high" }, 999);

    // 999ms old: still normal, so high goes first.
    expect(queue.peek(999)?.id).toBe("new-high");
    // 1000ms old: promoted to high; it arrived first so it now goes first.
    const next = queue.peek(1_000);
    expect(next).toMatchObject({ id: "old-normal", priority: "normal", effectivePriority: "high" });
  });

  it("never promotes above critical", () => {
    const queue = new JobPriorityQueue<string>(config);
    queue.enqueue("low", "x", { priority: "low" }, 0);
    expect(queue.peek(1_000_000)?.effectivePriority).toBe("critical");
  });

  it("lets an old low-priority job overtake newer critical work, so it cannot starve", () => {
    const queue = new JobPriorityQueue<string>(config);
    queue.enqueue("old-low", "x", { priority: "low" }, 0);
    // A steady stream of critical jobs arrives after the low job has aged to critical.
    queue.enqueue("c1", "x", { priority: "critical" }, 3_000);
    queue.enqueue("c2", "x", { priority: "critical" }, 3_001);

    expect(drain(queue, 3_001)).toEqual(["old-low", "c1", "c2"]);
  });

  it("serves a continuous critical stream without starving low work for long", () => {
    const queue = new JobPriorityQueue<string>(config);
    queue.enqueue("low", "x", { priority: "low" }, 0);
    let servedAt: number | undefined;
    for (let t = 0; t <= 10_000 && servedAt === undefined; t += 100) {
      queue.enqueue(`c-${t}`, "x", { priority: "critical" }, t);
      const job = queue.dequeue(t);
      if (job?.id === "low") servedAt = t;
    }
    // Low is promoted to critical after 3 x agingMs and then wins on arrival order.
    expect(servedAt).toBeDefined();
    expect(servedAt as number).toBeLessThanOrEqual(3_000);
  });

  it("counts jobs that left ahead of their original level", () => {
    const queue = new JobPriorityQueue<string>(config);
    queue.enqueue("a", "x", { priority: "low" }, 0);
    queue.enqueue("b", "x", { priority: "low" }, 5_000);
    queue.dequeue(5_000); // a has aged to critical
    queue.dequeue(5_000); // b is brand new, still low
    expect(queue.stats().promoted).toBe(1);
  });

  it("treats a clock that moves backwards as zero wait", () => {
    const queue = new JobPriorityQueue<string>(config);
    queue.enqueue("a", "x", { priority: "normal" }, 5_000);
    expect(queue.peek(1_000)).toMatchObject({ waitedMs: 0, effectivePriority: "normal" });
  });
});

describe("JobPriorityQueue capacity and duplicates", () => {
  it("applies backpressure per priority without blocking other levels", () => {
    const queue = new JobPriorityQueue<string>({ maxSizePerPriority: 2 });
    expect(queue.enqueue("l1", "x", { priority: "low" }, 0).accepted).toBe(true);
    expect(queue.enqueue("l2", "x", { priority: "low" }, 0).accepted).toBe(true);
    expect(queue.enqueue("l3", "x", { priority: "low" }, 0)).toEqual({ accepted: false, reason: "queue_full" });

    // A full low level cannot block a critical job.
    expect(queue.enqueue("c1", "x", { priority: "critical" }, 0).accepted).toBe(true);
    expect(queue.sizeByPriority()).toEqual({ critical: 1, high: 0, normal: 0, low: 2 });
    expect(queue.stats().rejectedFull).toBe(1);
  });

  it("frees capacity when jobs are dequeued or removed", () => {
    const queue = new JobPriorityQueue<string>({ maxSizePerPriority: 1 });
    queue.enqueue("a", "x", { priority: "high" }, 0);
    expect(queue.enqueue("b", "x", { priority: "high" }, 0).accepted).toBe(false);

    queue.dequeue(0);
    expect(queue.enqueue("b", "x", { priority: "high" }, 0).accepted).toBe(true);
    queue.remove("b");
    expect(queue.enqueue("c", "x", { priority: "high" }, 0).accepted).toBe(true);
  });

  it("rejects a duplicate id while queued but allows it again after it leaves", () => {
    const queue = new JobPriorityQueue<string>();
    queue.enqueue("a", "x", { priority: "low" }, 0);
    expect(queue.enqueue("a", "y", { priority: "critical" }, 0)).toEqual({
      accepted: false,
      reason: "duplicate",
    });
    expect(queue.size()).toBe(1);
    expect(queue.dequeue(0)?.payload).toBe("x");
    expect(queue.enqueue("a", "z", {}, 0).accepted).toBe(true);
    expect(queue.stats().rejectedDuplicate).toBe(1);
  });
});

describe("JobPriorityQueue removal and introspection", () => {
  it("removes a queued job from anywhere in the queue", () => {
    const queue = new JobPriorityQueue<string>();
    queue.enqueue("a", "x", { priority: "high" }, 0);
    queue.enqueue("b", "x", { priority: "high" }, 0);
    queue.enqueue("c", "x", { priority: "high" }, 0);

    expect(queue.remove("b")).toBe(true);
    expect(queue.remove("b")).toBe(false);
    expect(queue.remove("missing")).toBe(false);
    expect(queue.has("b")).toBe(false);
    expect(queue.size()).toBe(2);
    expect(drain(queue, 0)).toEqual(["a", "c"]);
  });

  it("skips a removed head and reports the next oldest enqueue time", () => {
    const queue = new JobPriorityQueue<string>();
    expect(queue.oldestEnqueuedAt()).toBeUndefined();

    queue.enqueue("a", "x", { priority: "low" }, 100);
    queue.enqueue("b", "x", { priority: "critical" }, 200);
    queue.enqueue("c", "x", { priority: "low" }, 300);
    expect(queue.oldestEnqueuedAt()).toBe(100);

    queue.remove("a");
    expect(queue.oldestEnqueuedAt()).toBe(200);
    queue.dequeue(300);
    expect(queue.oldestEnqueuedAt()).toBe(300);
  });

  it("stays correct and bounded through heavy enqueue/remove churn", () => {
    const queue = new JobPriorityQueue<number>({ maxSizePerPriority: 10 });
    queue.enqueue("head", 0, { priority: "normal" }, 0);
    for (let i = 0; i < 5_000; i += 1) {
      expect(queue.enqueue(`tmp-${i}`, i, { priority: "normal" }, i).accepted).toBe(true);
      expect(queue.remove(`tmp-${i}`)).toBe(true);
    }
    expect(queue.size()).toBe(1);
    expect(drain(queue, 6_000)).toEqual(["head"]);
  });

  it("compacts after many dequeues without losing order", () => {
    const queue = new JobPriorityQueue<number>();
    for (let i = 0; i < 300; i += 1) queue.enqueue(`j-${i}`, i, { priority: "low" }, i);
    for (let i = 0; i < 200; i += 1) expect(queue.dequeue(300)?.id).toBe(`j-${i}`);
    queue.enqueue("late", 0, { priority: "low" }, 301);
    expect(drain(queue, 301)).toEqual([...Array.from({ length: 100 }, (_, k) => `j-${k + 200}`), "late"]);
  });

  it("tracks stats", () => {
    const queue = new JobPriorityQueue<string>();
    queue.enqueue("a", "x", {}, 0);
    queue.enqueue("b", "x", {}, 0);
    queue.remove("b");
    queue.dequeue(0);
    expect(queue.stats()).toEqual({
      enqueued: 2,
      dequeued: 1,
      removed: 1,
      rejectedDuplicate: 0,
      rejectedFull: 0,
      promoted: 0,
    });
  });
});

describe("JobPriorityQueue input validation", () => {
  it("rejects invalid ids, priorities and clock values", () => {
    const queue = new JobPriorityQueue<string>();
    expect(() => queue.enqueue("", "x", {}, 0)).toThrow(TypeError);
    expect(() => queue.enqueue("   ", "x", {}, 0)).toThrow(TypeError);
    expect(() => queue.enqueue(42 as unknown as string, "x", {}, 0)).toThrow(TypeError);
    expect(() => queue.enqueue("a".repeat(257), "x", {}, 0)).toThrow(RangeError);
    expect(() => queue.enqueue("a", "x", { priority: "urgent" as JobPriority }, 0)).toThrow(TypeError);
    expect(() => queue.enqueue("a", "x", {}, Number.NaN)).toThrow(TypeError);
    expect(() => queue.dequeue(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => queue.peek("now" as unknown as number)).toThrow(TypeError);
    expect(queue.size()).toBe(0);
  });

  it("accepts an id at the length limit", () => {
    expect(new JobPriorityQueue<string>().enqueue("a".repeat(256), "x", {}, 0).accepted).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => new JobPriorityQueue({ maxSizePerPriority: 0 })).toThrow(RangeError);
    expect(() => new JobPriorityQueue({ maxSizePerPriority: 1.5 })).toThrow(RangeError);
    expect(() => new JobPriorityQueue({ agingMs: 0 })).toThrow(RangeError);
    expect(() => new JobPriorityQueue({ agingMs: -1 })).toThrow(RangeError);
  });

  it("has safe defaults", () => {
    expect(DEFAULT_PRIORITY_QUEUE_CONFIG).toEqual({ maxSizePerPriority: 10_000, agingMs: 30_000 });
  });
});

describe("resolveJobPriority", () => {
  it("defaults missing requests to normal", () => {
    expect(resolveJobPriority(undefined)).toBe("normal");
    expect(resolveJobPriority(null)).toBe("normal");
  });

  it("passes through allowed priorities", () => {
    expect(resolveJobPriority("high")).toBe("high");
    expect(resolveJobPriority("normal")).toBe("normal");
    expect(resolveJobPriority("low")).toBe("low");
  });

  it("keeps critical reserved: requests above the ceiling are lowered to it", () => {
    expect(resolveJobPriority("critical")).toBe("high");
    expect(resolveJobPriority("critical", "critical")).toBe("critical");
    expect(resolveJobPriority("high", "normal")).toBe("normal");
    expect(resolveJobPriority(undefined, "low")).toBe("low");
  });

  it("throws on unrecognised values instead of guessing", () => {
    expect(() => resolveJobPriority("urgent")).toThrow(TypeError);
    expect(() => resolveJobPriority(1)).toThrow(TypeError);
    expect(() => resolveJobPriority("")).toThrow(TypeError);
    expect(() => resolveJobPriority("high", "urgent" as JobPriority)).toThrow(TypeError);
  });
});

describe("BullMQ priority mapping", () => {
  it("maps to BullMQ's scale where 1 is highest", () => {
    expect(JOB_PRIORITIES.map(toBullMqPriority)).toEqual([1, 2, 3, 4]);
    expect(() => toBullMqPriority("urgent" as JobPriority)).toThrow(TypeError);
  });

  it("recognises valid priorities only", () => {
    expect(isJobPriority("critical")).toBe(true);
    expect(isJobPriority("Critical")).toBe(false);
    expect(isJobPriority(undefined)).toBe(false);
  });
});
