import {
  QueueBackpressureController,
  DEFAULT_BACKPRESSURE_OPTIONS,
  type BackpressureOptions,
} from "./queue-backpressure";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeController(overrides: Partial<BackpressureOptions> = {}): QueueBackpressureController {
  return new QueueBackpressureController({
    maxQueueDepth: 10,
    highWatermark: 5,
    criticalWatermark: 8,
    drainEnabled: true,
    drainToDepth: 2,
    ...overrides,
  });
}

// ─── Constructor validation ───────────────────────────────────────────────────

describe("QueueBackpressureController — constructor", () => {
  it("constructs with valid options", () => {
    expect(() => makeController()).not.toThrow();
  });

  it("throws when highWatermark >= criticalWatermark", () => {
    expect(() =>
      makeController({ highWatermark: 8, criticalWatermark: 8 }),
    ).toThrow(/highWatermark.*must be less than criticalWatermark/);
  });

  it("throws when criticalWatermark > maxQueueDepth", () => {
    expect(() =>
      makeController({ criticalWatermark: 11, maxQueueDepth: 10 }),
    ).toThrow(/criticalWatermark.*must not exceed maxQueueDepth/);
  });

  it("throws when drainToDepth >= highWatermark", () => {
    expect(() =>
      makeController({ drainToDepth: 5, highWatermark: 5 }),
    ).toThrow(/drainToDepth.*must be less than highWatermark/);
  });

  it("uses DEFAULT_BACKPRESSURE_OPTIONS when called with empty options", () => {
    const bp = new QueueBackpressureController();
    const m = bp.getMetrics();
    expect(m.depth).toBe(0);
    expect(m.level).toBe("normal");
  });
});

// ─── Normal level ─────────────────────────────────────────────────────────────

describe("normal level — all priorities accepted", () => {
  it("accepts all priorities when depth is below highWatermark", () => {
    const bp = makeController();
    for (const priority of ["low", "medium", "high", "critical"] as const) {
      const decision = bp.tryEnqueue(priority);
      expect(decision.accepted).toBe(true);
      expect(decision.level).toBe("normal");
    }
  });

  it("increments depth with each enqueue", () => {
    const bp = makeController();
    bp.tryEnqueue("low");
    bp.tryEnqueue("medium");
    expect(bp.currentDepth).toBe(2);
  });
});

// ─── Pressure level ───────────────────────────────────────────────────────────

describe("pressure level — low and medium are shed", () => {
  function atHighWatermark(): QueueBackpressureController {
    const bp = makeController();
    for (let i = 0; i < 5; i++) bp.tryEnqueue("high"); // fill to highWatermark
    return bp;
  }

  it("level transitions to pressure at highWatermark", () => {
    const bp = atHighWatermark();
    expect(bp.level).toBe("pressure");
  });

  it("rejects low priority at pressure level", () => {
    const bp = atHighWatermark();
    const d = bp.tryEnqueue("low");
    expect(d.accepted).toBe(false);
    expect(d.reason).toContain("pressure");
  });

  it("rejects medium priority at pressure level", () => {
    const bp = atHighWatermark();
    const d = bp.tryEnqueue("medium");
    expect(d.accepted).toBe(false);
  });

  it("accepts high priority at pressure level", () => {
    const bp = atHighWatermark();
    expect(bp.tryEnqueue("high").accepted).toBe(true);
  });

  it("accepts critical priority at pressure level", () => {
    const bp = atHighWatermark();
    expect(bp.tryEnqueue("critical").accepted).toBe(true);
  });
});

// ─── Critical level ───────────────────────────────────────────────────────────

describe("critical level — only critical accepted", () => {
  function atCriticalWatermark(): QueueBackpressureController {
    const bp = makeController();
    for (let i = 0; i < 8; i++) bp.tryEnqueue("critical"); // fill to criticalWatermark
    return bp;
  }

  it("level transitions to critical at criticalWatermark", () => {
    const bp = atCriticalWatermark();
    expect(bp.level).toBe("critical");
  });

  it("rejects high priority at critical level", () => {
    const bp = atCriticalWatermark();
    expect(bp.tryEnqueue("high").accepted).toBe(false);
  });

  it("accepts critical priority at critical level", () => {
    const bp = atCriticalWatermark();
    expect(bp.tryEnqueue("critical").accepted).toBe(true);
  });
});

// ─── Overloaded level ─────────────────────────────────────────────────────────

describe("overloaded level — nothing accepted", () => {
  function atMax(): QueueBackpressureController {
    const bp = makeController();
    for (let i = 0; i < 10; i++) bp.tryEnqueue("critical");
    return bp;
  }

  it("level transitions to overloaded at maxQueueDepth", () => {
    const bp = atMax();
    expect(bp.level).toBe("overloaded");
  });

  it("rejects critical priority when overloaded", () => {
    const bp = atMax();
    const d = bp.tryEnqueue("critical");
    expect(d.accepted).toBe(false);
    expect(d.reason).toContain("maximum capacity");
  });
});

// ─── dequeue ──────────────────────────────────────────────────────────────────

describe("dequeue", () => {
  it("decrements depth", () => {
    const bp = makeController();
    bp.tryEnqueue("high");
    bp.tryEnqueue("high");
    bp.dequeue();
    expect(bp.currentDepth).toBe(1);
  });

  it("does not go below zero", () => {
    const bp = makeController();
    bp.dequeue(100);
    expect(bp.currentDepth).toBe(0);
  });

  it("accepts a batch count", () => {
    const bp = makeController();
    bp.tryEnqueue("high");
    bp.tryEnqueue("high");
    bp.tryEnqueue("high");
    bp.dequeue(3);
    expect(bp.currentDepth).toBe(0);
  });

  it("restores normal level after draining below highWatermark", () => {
    const bp = makeController();
    for (let i = 0; i < 7; i++) bp.tryEnqueue("high"); // reach pressure
    expect(bp.level).toBe("pressure");
    bp.dequeue(4); // drop to 3
    expect(bp.level).toBe("normal");
  });
});

// ─── drain mode ───────────────────────────────────────────────────────────────

describe("drain mode", () => {
  it("activates draining and enforces critical-only acceptance", () => {
    const bp = makeController();
    bp.tryEnqueue("high"); // depth = 1 (normal)
    bp.drain();

    // During drain, level is treated as critical so medium is rejected.
    const d = bp.tryEnqueue("medium");
    expect(d.accepted).toBe(false);
    expect(bp.getMetrics().draining).toBe(true);
  });

  it("exits drain mode once depth falls to drainToDepth", () => {
    const bp = makeController();
    for (let i = 0; i < 6; i++) bp.tryEnqueue("high"); // depth = 6
    bp.drain();

    bp.dequeue(4); // depth = 2, drainToDepth = 2 → should exit draining
    expect(bp.getMetrics().draining).toBe(false);
    expect(bp.tryEnqueue("medium").accepted).toBe(true);
  });

  it("drain() is a no-op when drainEnabled is false", () => {
    const bp = makeController({ drainEnabled: false });
    bp.tryEnqueue("high");
    bp.drain();

    expect(bp.getMetrics().draining).toBe(false);
    expect(bp.tryEnqueue("low").accepted).toBe(true);
  });
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

describe("metrics", () => {
  it("tracks accepted, rejected, and dequeued counts", () => {
    const bp = makeController();
    bp.tryEnqueue("low");   // accepted
    bp.tryEnqueue("low");   // accepted
    for (let i = 0; i < 5; i++) bp.tryEnqueue("high"); // fills to highWatermark=5, all accepted
    bp.tryEnqueue("low");   // pressure — rejected

    const m = bp.getMetrics();
    expect(m.accepted).toBe(7);
    expect(m.rejected).toBe(1);

    bp.dequeue(3);
    expect(bp.getMetrics().dequeued).toBe(3);
  });

  it("tracks highWatermarkBreaches", () => {
    const bp = makeController();
    for (let i = 0; i < 6; i++) bp.tryEnqueue("high"); // crosses highWatermark on 6th
    expect(bp.getMetrics().highWatermarkBreaches).toBe(1);
  });

  it("tracks criticalWatermarkBreaches", () => {
    const bp = makeController();
    for (let i = 0; i < 9; i++) bp.tryEnqueue("critical"); // crosses critical on 9th
    expect(bp.getMetrics().criticalWatermarkBreaches).toBe(1);
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("reset", () => {
  it("zeroes all counters and depth", () => {
    const bp = makeController();
    bp.tryEnqueue("high");
    bp.tryEnqueue("low");
    bp.reset();

    const m = bp.getMetrics();
    expect(m.depth).toBe(0);
    expect(m.accepted).toBe(0);
    expect(m.rejected).toBe(0);
    expect(m.level).toBe("normal");
    expect(m.draining).toBe(false);
  });
});

// ─── Integration / realistic scenario ────────────────────────────────────────

describe("realistic scenario — burst of work items across all priorities", () => {
  it("maintains correct depth and level under a mixed-priority burst", () => {
    const bp = makeController({
      maxQueueDepth: 20,
      highWatermark: 10,
      criticalWatermark: 15,
      drainEnabled: true,
      drainToDepth: 4,
    });

    // Simulate 12 low-priority enqueues (first 10 accepted, then shed).
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 12; i++) {
      const d = bp.tryEnqueue("low");
      if (d.accepted) accepted++; else rejected++;
    }
    expect(accepted).toBe(10);  // 0-9 accepted (fill to depth=10 = highWatermark)
    expect(rejected).toBe(2);   // 10-11 rejected

    // High-priority items can still get through at pressure.
    expect(bp.tryEnqueue("high").accepted).toBe(true);
    expect(bp.tryEnqueue("critical").accepted).toBe(true);

    // Activate drain: only critical goes through.
    bp.drain();
    expect(bp.tryEnqueue("high").accepted).toBe(false);
    expect(bp.tryEnqueue("critical").accepted).toBe(true);

    // Drain down to target.
    bp.dequeue(10);
    expect(bp.getMetrics().draining).toBe(false);

    // Normal acceptance resumes.
    expect(bp.tryEnqueue("low").accepted).toBe(true);
  });
});
