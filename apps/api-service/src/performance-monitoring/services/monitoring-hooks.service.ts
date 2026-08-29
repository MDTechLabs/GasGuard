import { Injectable } from "@nestjs/common";

export interface MetricLabels {
  [key: string]: string | number | boolean | undefined;
}

export interface CounterMetricSnapshot {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface GaugeMetricSnapshot {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface HistogramMetricSnapshot {
  name: string;
  labels: Record<string, string>;
  count: number;
  sum: number;
  min: number;
  max: number;
  average: number;
}

export interface MonitoringSnapshot {
  counters: CounterMetricSnapshot[];
  gauges: GaugeMetricSnapshot[];
  histograms: HistogramMetricSnapshot[];
}

interface HistogramMetricState {
  count: number;
  sum: number;
  min: number;
  max: number;
}

@Injectable()
export class MonitoringHooksService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramMetricState>();

  incrementCounter(name: string, value = 1, labels?: MetricLabels): number {
    const key = this.buildMetricKey(name, labels);
    const next = (this.counters.get(key) || 0) + value;
    this.counters.set(key, next);
    return next;
  }

  setGauge(name: string, value: number, labels?: MetricLabels): number {
    const key = this.buildMetricKey(name, labels);
    this.gauges.set(key, value);
    return value;
  }

  adjustGauge(name: string, delta: number, labels?: MetricLabels): number {
    const key = this.buildMetricKey(name, labels);
    const next = (this.gauges.get(key) || 0) + delta;
    this.gauges.set(key, next);
    return next;
  }

  observeHistogram(
    name: string,
    value: number,
    labels?: MetricLabels,
  ): HistogramMetricSnapshot {
    const key = this.buildMetricKey(name, labels);
    const current = this.histograms.get(key) || {
      count: 0,
      sum: 0,
      min: value,
      max: value,
    };

    const next: HistogramMetricState = {
      count: current.count + 1,
      sum: current.sum + value,
      min: Math.min(current.min, value),
      max: Math.max(current.max, value),
    };

    this.histograms.set(key, next);
    return this.toHistogramSnapshot(key, next);
  }

  getSnapshot(): MonitoringSnapshot {
    return {
      counters: Array.from(this.counters.entries()).map(([key, value]) =>
        this.toNumberSnapshot(key, value),
      ),
      gauges: Array.from(this.gauges.entries()).map(([key, value]) =>
        this.toNumberSnapshot(key, value),
      ),
      histograms: Array.from(this.histograms.entries()).map(([key, value]) =>
        this.toHistogramSnapshot(key, value),
      ),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private buildMetricKey(name: string, labels?: MetricLabels): string {
    return JSON.stringify({
      name,
      labels: this.normalizeLabels(labels),
    });
  }

  private normalizeLabels(labels?: MetricLabels): Record<string, string> {
    if (!labels) {
      return {};
    }

    return Object.entries(labels)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, string>>((acc, [key, value]) => {
        acc[key] = String(value);
        return acc;
      }, {});
  }

  private parseMetricKey(key: string): {
    name: string;
    labels: Record<string, string>;
  } {
    return JSON.parse(key) as { name: string; labels: Record<string, string> };
  }

  private toNumberSnapshot(
    key: string,
    value: number,
  ): CounterMetricSnapshot | GaugeMetricSnapshot {
    const parsed = this.parseMetricKey(key);
    return {
      ...parsed,
      value,
    };
  }

  private toHistogramSnapshot(
    key: string,
    histogram: HistogramMetricState,
  ): HistogramMetricSnapshot {
    const parsed = this.parseMetricKey(key);
    return {
      ...parsed,
      count: histogram.count,
      sum: histogram.sum,
      min: histogram.min,
      max: histogram.max,
      average: histogram.count === 0 ? 0 : histogram.sum / histogram.count,
    };
  }
}
