/**
 * Polling worker that drives `MaintainerSignalService.processNext`.
 *
 * The worker processes jobs back to back while any are due and sleeps for
 * `idleDelayMs` when the queue is empty. `stop()` lets the in-flight job finish
 * before resolving, so it can be registered as a `GracefulShutdown` hook.
 */

import { MaintainerSignalService } from "./maintainer-signal.service";

export interface MaintainerSignalWorkerOptions {
  workerId: string;
  /** Sleep between polls when no job is due. */
  idleDelayMs?: number;
}

export class MaintainerSignalWorker {
  private readonly service: MaintainerSignalService;
  private readonly workerId: string;
  private readonly idleDelayMs: number;
  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;

  constructor(
    service: MaintainerSignalService,
    options: MaintainerSignalWorkerOptions,
  ) {
    if (
      typeof options.workerId !== "string" ||
      options.workerId.trim() === ""
    ) {
      throw new TypeError("workerId must be a non-empty string");
    }
    const idleDelayMs = options.idleDelayMs ?? 1_000;
    if (!Number.isInteger(idleDelayMs) || idleDelayMs <= 0) {
      throw new RangeError("idleDelayMs must be a positive integer");
    }
    this.service = service;
    this.workerId = options.workerId;
    this.idleDelayMs = idleDelayMs;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop = this.run();
  }

  /** Stop polling and wait for any in-flight job to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let idle = true;
      try {
        idle =
          (await this.service.processNext(this.workerId)).status === "idle";
      } catch {
        // processNext handles job failures itself; anything reaching here is
        // unexpected, so back off rather than spin.
        idle = true;
      }
      if (idle && this.running) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.idleDelayMs);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.wake = undefined;
      }
    }
  }
}
