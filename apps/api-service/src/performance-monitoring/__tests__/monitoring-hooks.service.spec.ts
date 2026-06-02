import { MonitoringHooksService } from "../services/monitoring-hooks.service";

describe("MonitoringHooksService", () => {
  let service: MonitoringHooksService;

  beforeEach(() => {
    service = new MonitoringHooksService();
  });

  it("increments counters using label-insensitive ordering", () => {
    service.incrementCounter("http_requests_total", 1, {
      statusCode: 200,
      method: "GET",
    });
    service.incrementCounter("http_requests_total", 2, {
      method: "GET",
      statusCode: 200,
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.counters).toEqual([
      {
        name: "http_requests_total",
        labels: { method: "GET", statusCode: "200" },
        value: 3,
      },
    ]);
  });

  it("tracks gauges and histogram summaries", () => {
    service.setGauge("http_requests_in_flight", 2, { method: "POST" });
    service.observeHistogram("http_request_duration_ms", 100, {
      endpoint: "/api/scanner",
    });
    service.observeHistogram("http_request_duration_ms", 300, {
      endpoint: "/api/scanner",
    });

    const snapshot = service.getSnapshot();

    expect(snapshot.gauges).toEqual([
      {
        name: "http_requests_in_flight",
        labels: { method: "POST" },
        value: 2,
      },
    ]);
    expect(snapshot.histograms).toEqual([
      {
        name: "http_request_duration_ms",
        labels: { endpoint: "/api/scanner" },
        count: 2,
        sum: 400,
        min: 100,
        max: 300,
        average: 200,
      },
    ]);
  });
});
