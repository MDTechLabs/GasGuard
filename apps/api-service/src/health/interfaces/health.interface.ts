export enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded',
}

export interface HealthCheckResponse {
  status: HealthStatus;
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  checks: Record<string, HealthStatus>;
}
