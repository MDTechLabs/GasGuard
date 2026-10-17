# Job Priority Queues

Scans are not equally urgent. A blocking CI check should not wait behind a nightly full-repository
audit. `JobPriorityQueue` orders queued work by priority and keeps low-priority work from starving.

| Piece | Location |
| --- | --- |
| Queue, priority resolution, BullMQ mapping | `apps/api/src/queue/priority-queue.ts` |
| Unit tests (normal, boundary, failure) | `apps/api/src/queue/priority-queue.spec.ts` |

The module is self-contained: no I/O, no clock reads, no dependency on other queue modules. Callers
pass `now`, as with the other queue primitives, so behaviour is deterministic.

## Priorities

| Priority | BullMQ value | Intended use |
| --- | --- | --- |
| `critical` | 1 | Internal, blocking work. Reserved: not grantable to ordinary callers. |
| `high` | 2 | Interactive and CI scans. The default ceiling for requests. |
| `normal` | 3 | Default. |
| `low` | 4 | Scheduled and bulk scans. |

Within a priority, jobs run in arrival order.

## Interface

```ts
import { JobPriorityQueue, resolveJobPriority } from './queue/priority-queue';

const queue = new JobPriorityQueue<ScanRequest>({ maxSizePerPriority: 10_000, agingMs: 30_000 });

// Untrusted input is clamped to a ceiling ('high' by default) and validated.
const priority = resolveJobPriority(request.priority);

const result = queue.enqueue(scanId, request, { priority }, now);
if (!result.accepted) {
  // result.reason is 'duplicate' or 'queue_full'. Apply backpressure.
}

const job = queue.dequeue(now); // QueuedJob | undefined
queue.remove(scanId);           // cancel
queue.oldestEnqueuedAt();       // feed QueueAgeSlo.evaluate
queue.sizeByPriority();         // metrics
queue.stats();                  // counters
```

Using it with BullMQ: `{ ...withRetryOptions(), priority: toBullMqPriority(priority) }`.

## Starvation protection (aging)

Every `agingMs` a job has waited promotes it one level, up to `critical`. A promoted job competes with
other jobs at that level by arrival order, so a `low` job waits at most about `3 x agingMs` before
it is ahead of any newer job, even under a constant stream of `critical` work. `effectivePriority`
on the dequeued job shows the level it was competing at, and `stats().promoted` counts jobs that left
ahead of their original level.

## Configuration and secure defaults

| Option | Default | Notes |
| --- | --- | --- |
| `maxSizePerPriority` | 10,000 | Capacity of each level. Per-level limits mean a flood of low-priority work cannot block a `critical` job from being accepted. |
| `agingMs` | 30,000 | Must be a positive integer. Use a very large value to effectively disable aging. |

- **Callers cannot escalate themselves.** `resolveJobPriority(requested, ceiling = 'high')` lowers
  anything above the ceiling. Pass `'critical'` as the ceiling only for trusted callers.
- **Unrecognised priorities are errors**, never silently promoted or demoted.
- Job ids are non-empty strings of at most 256 characters.

## Failure semantics

- **Cannot accept**: `enqueue` returns `{ accepted: false, reason: 'duplicate' | 'queue_full' }` rather
  than throwing, so callers can retry later or return a 429-style response. A duplicate is an id that
  is still queued; once a job is dequeued or removed its id may be enqueued again.
- **Invalid arguments** (bad id, unknown priority, non-finite `now`, invalid config) throw
  `TypeError` or `RangeError`, and the queue is left unchanged.
- **Clock skew**: a `now` earlier than a job's enqueue time counts as zero wait, never a negative one.
- **Cancelled jobs** are dropped lazily and the backing arrays are compacted, so memory stays bounded
  under enqueue/cancel churn.

## Dependencies and limits

- Reads nothing from other components. It complements `RepositoryScanQuota` (admission per repository),
  `ScanDeduplicator` and `QueueAgeSlo`, which a dispatcher can combine with it.
- It is an in-process queue. It does not persist jobs, and it does not make Redis-backed BullMQ queues
  priority-aware by itself; use `toBullMqPriority` for that. A retried job re-enters as a new job and
  starts aging again.
- Fairness between tenants at the same priority is not part of this module. Use the per-repository
  quota for that.
