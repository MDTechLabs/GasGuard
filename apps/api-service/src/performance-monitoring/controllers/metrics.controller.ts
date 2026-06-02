import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { MonitoringHooksService } from "../services/monitoring-hooks.service";

@ApiTags("Monitoring")
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly monitoringHooksService: MonitoringHooksService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Expose in-memory monitoring metrics snapshot" })
  getMetrics() {
    return this.monitoringHooksService.getSnapshot();
  }
}
