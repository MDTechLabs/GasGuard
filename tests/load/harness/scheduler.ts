/**
 * Discrete-event scheduler with a virtual clock.
 *
 * Load runs execute in simulated time: nothing sleeps, so minutes of queue
 * behaviour run in milliseconds and give identical results on every machine.
 * Events at the same instant run in the order they were scheduled.
 */

interface Entry {
  at: number;
  seq: number;
  run: () => void;
}

export class EventScheduler {
  private heap: Entry[] = [];
  private seq = 0;
  private current = 0;
  private executed = 0;

  /** Current virtual time in milliseconds. */
  get now(): number {
    return this.current;
  }

  get pending(): number {
    return this.heap.length;
  }

  get processed(): number {
    return this.executed;
  }

  schedule(at: number, run: () => void): void {
    if (!Number.isFinite(at)) {
      throw new TypeError("event time must be a finite number");
    }
    if (at < this.current) {
      throw new RangeError(`cannot schedule in the past (${at} < ${this.current})`);
    }
    this.push({ at, seq: this.seq++, run });
  }

  after(delayMs: number, run: () => void): void {
    this.schedule(this.current + delayMs, run);
  }

  /** Runs the next event. Returns false when none remain. */
  step(): boolean {
    const entry = this.pop();
    if (!entry) {
      return false;
    }
    this.current = entry.at;
    this.executed += 1;
    entry.run();
    return true;
  }

  private less(a: Entry, b: Entry): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  private push(entry: Entry): void {
    const heap = this.heap;
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  private pop(): Entry | undefined {
    const heap = this.heap;
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop() as Entry;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let min = i;
        if (l < heap.length && this.less(heap[l], heap[min])) min = l;
        if (r < heap.length && this.less(heap[r], heap[min])) min = r;
        if (min === i) break;
        [heap[i], heap[min]] = [heap[min], heap[i]];
        i = min;
      }
    }
    return top;
  }
}
