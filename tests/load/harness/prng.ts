/**
 * Seeded pseudo-random numbers for reproducible load runs.
 *
 * Math.random is never used in the load suite: a failing run must be replayable
 * from its seed alone. Independent streams (`fork`) keep one concern's draws
 * (say, arrivals) from shifting another's (say, faults) when code changes.
 */

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export class Rng {
  private state: number;

  constructor(private readonly seed: number) {
    if (!Number.isInteger(seed)) {
      throw new TypeError("seed must be an integer");
    }
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1) (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError("int() needs integers with min <= max");
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p` (0 never, 1 always). */
  chance(p: number): boolean {
    if (!(p >= 0 && p <= 1)) {
      throw new RangeError("probability must be within [0, 1]");
    }
    return this.next() < p;
  }

  /** Exponentially distributed value with the given mean (for Poisson gaps). */
  exponential(mean: number): number {
    if (!(mean > 0) || !Number.isFinite(mean)) {
      throw new RangeError("mean must be a positive finite number");
    }
    return -mean * Math.log(1 - this.next());
  }

  /** An independent stream derived from this seed and a label. */
  fork(label: string): Rng {
    const derived = hashString(`${this.seed}:${label}`);
    return new Rng(derived === 0 ? 1 : derived | 0);
  }
}
