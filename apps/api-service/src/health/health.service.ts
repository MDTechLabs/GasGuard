import { Injectable } from '@nestjs/common';
import { HealthCheckResponse, HealthStatus } from './interfaces/health.interface';

@Injectable()
export class HealthService {
  private readonly startTime: Date;

  constructor() {
    this.startTime = new Date();
  }

  check(): HealthCheckResponse {
    return {
      status: HealthStatus.HEALTHY,
      service: 'gasguard-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      checks: {
        api: HealthStatus.HEALTHY,
        scanner: HealthStatus.HEALTHY,
        analyzer: HealthStatus.HEALTHY,
        rules: HealthStatus.HEALTHY,
      },
    };
  }

  checkReadiness(): HealthCheckResponse {
    return {
      status: HealthStatus.HEALTHY,
      service: 'gasguard-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      checks: {
        ready: HealthStatus.HEALTHY,
      },
    };
  }

  checkLiveness(): HealthCheckResponse {
    return {
      status: HealthStatus.HEALTHY,
      service: 'gasguard-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      checks: {
        alive: HealthStatus.HEALTHY,
      },
    };
  }

  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime.getTime()) / 1000);
  }
}
