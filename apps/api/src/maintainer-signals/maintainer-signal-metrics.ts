/**
 * Metrics and structured logging for maintainer change signals.
 *
 * Metric labels come from closed sets (outcomes, error codes, signal types,
 * skip reasons, configured ecosystems), never from tenant, repository, package,
 * or maintainer data, so cardinality stays bounded and no registry identities
 * reach a metrics backend.
 *
 * Log lines carry identifiers, counts, and codes only. On top of the SBOM log
 * sanitizer (which drops payload/credential-like keys) this module also drops
 * keys that could carry maintainer identities or emails.
 */

import { sanitizeLogFields as sanitizeSbomLogFields } from "../sbom/sbom-metrics";
import type {
  MaintainerSignalType,
  PackageSkipReason,
} from "./maintainer-signal-types";

export interface MaintainerSignalQueueStats {
  pending: number;
  running: number;
  completed: number;
  deadLettered: number;
}

export interface MaintainerSignalMetricsSnapshot {
  submissions: Record<string, number>;
  submissionRejections: Record<string, number>;
  jobsCompleted: Record<string, number>;
  jobFailures: Record<string, number>;
  jobsRetried: number;
  jobsDeadLettered: number;
  staleCompletions: number;
  leasesRecovered: number;
  lookups: Record<string, number>;
  lookupRetries: number;
  packagesSkipped: Record<string, number>;
  signals: Record<string, number>;
  analyzeDurationMs: { count: number; sum: number; max: number };
}

export class MaintainerSignalMetrics {
  private readonly submissions = new Map<string, number>();
  private readonly submissionRejections = new Map<string, number>();
  private readonly jobsCompleted = new Map<string, number>();
  private readonly jobFailures = new Map<string, number>();
  private readonly lookups = new Map<string, number>();
  private readonly packagesSkipped = new Map<string, number>();
  private readonly signals = new Map<string, number>();
  private jobsRetried = 0;
  private jobsDeadLettered = 0;
  private staleCompletions = 0;
  private leasesRecovered = 0;
  private lookupRetries = 0;
  private durationCount = 0;
  private durationSum = 0;
  private durationMax = 0;

  recordSubmission(
    outcome: "accepted" | "duplicate" | "rejected",
    errorCode?: string,
  ): void {
    increment(this.submissions, outcome);
    if (outcome === "rejected" && errorCode) {
      increment(this.submissionRejections, errorCode);
    }
  }

  /** `ecosystem` must come from the configured allow-list. */
  recordLookup(
    ecosystem: string,
    outcome: "found" | "not_found" | "invalid" | "failed",
  ): void {
    increment(this.lookups, `${ecosystem}\u0000${outcome}`);
  }

  recordLookupRetry(): void {
    this.lookupRetries++;
  }

  recordCompleted(
    status: "complete" | "partial",
    durationMs: number,
    signalCounts: Partial<Record<MaintainerSignalType, number>>,
    skipCounts: Partial<Record<PackageSkipReason, number>>,
  ): void {
    increment(this.jobsCompleted, status);
    for (const [type, count] of Object.entries(signalCounts)) {
      increment(this.signals, type, count ?? 0);
    }
    for (const [reason, count] of Object.entries(skipCounts)) {
      increment(this.packagesSkipped, reason, count ?? 0);
    }
    this.recordDuration(durationMs);
  }

  recordFailure(
    errorCode: string,
    outcome: "retry_scheduled" | "dead_lettered",
    durationMs: number,
  ): void {
    increment(this.jobFailures, errorCode);
    if (outcome === "retry_scheduled") {
      this.jobsRetried++;
    } else {
      this.jobsDeadLettered++;
    }
    this.recordDuration(durationMs);
  }

  recordStale(): void {
    this.staleCompletions++;
  }

  recordLeasesRecovered(count: number): void {
    this.leasesRecovered += count;
  }

  snapshot(): MaintainerSignalMetricsSnapshot {
    return {
      submissions: Object.fromEntries(this.submissions),
      submissionRejections: Object.fromEntries(this.submissionRejections),
      jobsCompleted: Object.fromEntries(this.jobsCompleted),
      jobFailures: Object.fromEntries(this.jobFailures),
      jobsRetried: this.jobsRetried,
      jobsDeadLettered: this.jobsDeadLettered,
      staleCompletions: this.staleCompletions,
      leasesRecovered: this.leasesRecovered,
      lookups: Object.fromEntries(
        [...this.lookups].map(([k, v]) => [k.replace("\u0000", ":"), v]),
      ),
      lookupRetries: this.lookupRetries,
      packagesSkipped: Object.fromEntries(this.packagesSkipped),
      signals: Object.fromEntries(this.signals),
      analyzeDurationMs: {
        count: this.durationCount,
        sum: this.durationSum,
        max: this.durationMax,
      },
    };
  }

  /** Prometheus text exposition, plus optional queue gauges. */
  toPrometheus(queue?: Partial<MaintainerSignalQueueStats>): string {
    const lines: string[] = [];
    const metric = (
      name: string,
      type: "counter" | "gauge",
      help: string,
      samples: Array<[string, number]>,
    ) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, value] of samples) {
        lines.push(`${name}${labels} ${value}`);
      }
    };
    const labelled = (map: Map<string, number>, label: string) =>
      [...map].map(([k, v]) => [`{${label}="${k}"}`, v] as [string, number]);

    metric(
      "gasguard_maintainer_signal_submissions_total",
      "counter",
      "Maintainer signal submissions by outcome.",
      labelled(this.submissions, "outcome"),
    );
    metric(
      "gasguard_maintainer_signal_submission_rejections_total",
      "counter",
      "Rejected maintainer signal submissions by error code.",
      labelled(this.submissionRejections, "code"),
    );
    metric(
      "gasguard_maintainer_signal_jobs_completed_total",
      "counter",
      "Maintainer signal jobs completed, by report status.",
      labelled(this.jobsCompleted, "status"),
    );
    metric(
      "gasguard_maintainer_signal_job_failures_total",
      "counter",
      "Failed maintainer signal job attempts by error code.",
      labelled(this.jobFailures, "code"),
    );
    metric(
      "gasguard_maintainer_signal_jobs_dead_lettered_total",
      "counter",
      "Maintainer signal jobs dead-lettered.",
      [["", this.jobsDeadLettered]],
    );
    metric(
      "gasguard_maintainer_signal_stale_completions_total",
      "counter",
      "Completions rejected because the lease was lost.",
      [["", this.staleCompletions]],
    );
    metric(
      "gasguard_maintainer_signal_leases_recovered_total",
      "counter",
      "Expired leases returned to the queue.",
      [["", this.leasesRecovered]],
    );
    metric(
      "gasguard_maintainer_registry_lookups_total",
      "counter",
      "Registry lookups by ecosystem and outcome.",
      [...this.lookups].map(([key, v]) => {
        const [ecosystem, outcome] = key.split("\u0000");
        return [`{ecosystem="${ecosystem}",outcome="${outcome}"}`, v];
      }),
    );
    metric(
      "gasguard_maintainer_registry_lookup_retries_total",
      "counter",
      "Registry lookups retried after a transient failure.",
      [["", this.lookupRetries]],
    );
    metric(
      "gasguard_maintainer_packages_skipped_total",
      "counter",
      "Packages left out of reports, by reason.",
      labelled(this.packagesSkipped, "reason"),
    );
    metric(
      "gasguard_maintainer_signals_total",
      "counter",
      "Maintainer change signals reported, by type.",
      labelled(this.signals, "type"),
    );
    if (queue) {
      metric(
        "gasguard_maintainer_signal_queue_jobs",
        "gauge",
        "Maintainer signal jobs by status.",
        Object.entries(queue).map(([status, v]) => [
          `{status="${status}"}`,
          v ?? 0,
        ]),
      );
    }
    return `${lines.join("\n")}\n`;
  }

  private recordDuration(durationMs: number): void {
    const value = Math.max(0, durationMs);
    this.durationCount++;
    this.durationSum += value;
    this.durationMax = Math.max(this.durationMax, value);
  }
}

export type MaintainerSignalLogLevel = "info" | "warn" | "error";
export type MaintainerSignalLogFields = Record<
  string,
  string | number | boolean | undefined
>;

export interface MaintainerSignalLogger {
  log(
    level: MaintainerSignalLogLevel,
    event: string,
    fields: MaintainerSignalLogFields,
  ): void;
}

/** Keys that could carry maintainer identities or contact data. */
const FORBIDDEN_IDENTITY_KEY =
  /email|handle|login|maintainer(?!s?Count)|publisher|user/i;

export function sanitizeMaintainerLogFields(
  fields: Record<string, unknown>,
): MaintainerSignalLogFields {
  const safe = sanitizeSbomLogFields(fields);
  for (const key of Object.keys(safe)) {
    if (FORBIDDEN_IDENTITY_KEY.test(key)) {
      delete safe[key];
    }
  }
  return safe;
}

/** Emits one JSON object per line on stdout/stderr. */
export const consoleMaintainerSignalLogger: MaintainerSignalLogger = {
  log(level, event, fields) {
    const line = JSON.stringify({
      level,
      component: "maintainer-signals",
      event,
      ...sanitizeMaintainerLogFields(fields),
    });
    if (level === "info") {
      console.log(line);
    } else {
      console.error(line);
    }
  },
};

function increment(map: Map<string, number>, key: string, by = 1): void {
  if (by === 0) return;
  map.set(key, (map.get(key) ?? 0) + by);
}
