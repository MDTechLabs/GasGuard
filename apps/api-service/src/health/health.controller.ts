import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthCheckResponse } from './interfaces/health.interface';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): HealthCheckResponse {
    return this.healthService.check();
  }

  @Get('ready')
  readiness(): HealthCheckResponse {
    return this.healthService.checkReadiness();
  }

  @Get('live')
  liveness(): HealthCheckResponse {
    return this.healthService.checkLiveness();
  }
}
