import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  PerformanceMetricService,
  MetricRecord,
} from "../services/performance-metric.service";
import { MetricAggregationWindow } from "../entities/api-performance-metric.entity";

@ApiTags("Performance Monitoring")
@Controller("api/performance")
export class PerformanceController {
  constructor(
    private readonly performanceMetricService: PerformanceMetricService,
  ) {}

  @Get("health")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  health() {
    return { status: "ok", service: "performance-monitoring" };
  }

  @Post("metrics")
  @HttpCode(HttpStatus.CREATED)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async recordMetric(@Body() metric: MetricRecord) {
    const recorded = await this.performanceMetricService.recordMetric(metric);
    return { success: true, id: recorded.id };
  }

  @Get("realtime")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRealtimeSummary() {
    return this.performanceMetricService.getRealtimeSummary();
  }

  @Get("recent")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRecentMetrics(
    @Query("limit") limit?: number,
    @Query("endpoint") endpoint?: string,
  ) {
    return this.performanceMetricService.getRecentMetrics(
      limit || 100,
      endpoint,
    );
  }

  @Get("history/:endpoint")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getHistory(
    @Param("endpoint") endpoint: string,
    @Query("window") window?: MetricAggregationWindow,
    @Query("startTime") startTime?: string,
    @Query("endTime") endTime?: string,
  ) {
    const windowEnum = window || MetricAggregationWindow.HOUR;

    let start: Date;
    let end: Date;

    if (startTime && endTime) {
      start = new Date(startTime);
      end = new Date(endTime);
    } else {
      // Default to last 24 hours
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - 1);
    }

    return this.performanceMetricService.getAggregates(
      endpoint,
      windowEnum,
      start,
      end,
    );
  }

  @Get("aggregate/:endpoint")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getAggregate(
    @Param("endpoint") endpoint: string,
    @Query("window") window?: MetricAggregationWindow,
  ) {
    const windowEnum = window || MetricAggregationWindow.HOUR;
    return this.performanceMetricService.getLatestAggregate(
      endpoint,
      windowEnum,
    );
  }

  @Post("aggregate/:endpoint/:method")
  @HttpCode(HttpStatus.CREATED)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async triggerAggregation(
    @Param("endpoint") endpoint: string,
    @Param("method") method: string,
    @Query("window") window?: MetricAggregationWindow,
  ) {
    const windowEnum = window || MetricAggregationWindow.HOUR;
    const endTime = new Date();
    const startTime = new Date();

    // Calculate start time based on window
    switch (windowEnum) {
      case MetricAggregationWindow.MINUTE:
        startTime.setMinutes(startTime.getMinutes() - 1);
        break;
      case MetricAggregationWindow.HOUR:
        startTime.setHours(startTime.getHours() - 1);
        break;
      case MetricAggregationWindow.DAY:
        startTime.setDate(startTime.getDate() - 1);
        break;
    }

    const aggregate = await this.performanceMetricService.aggregateMetrics(
      endpoint,
      method,
      windowEnum,
      startTime,
      endTime,
    );

    return { success: true, aggregate };
  }
}
