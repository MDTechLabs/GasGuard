import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ApiPerformanceMetric,
  ApiPerformanceAggregate,
} from "./entities/api-performance-metric.entity";
import { MetricsController } from "./controllers/metrics.controller";
import { PerformanceLoggingMiddleware } from "./middleware/performance-logging.middleware";
import { MonitoringHooksService } from "./services/monitoring-hooks.service";
import { PerformanceMetricService } from "./services/performance-metric.service";
import { PerformanceController } from "./controllers/performance.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiPerformanceMetric, ApiPerformanceAggregate]),
  ],
  controllers: [PerformanceController, MetricsController],
  providers: [
    PerformanceMetricService,
    MonitoringHooksService,
    PerformanceLoggingMiddleware,
  ],
  exports: [PerformanceMetricService, MonitoringHooksService],
})
export class PerformanceMonitoringModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(PerformanceLoggingMiddleware)
      .exclude(
        { path: "health", method: RequestMethod.ALL },
        { path: "metrics", method: RequestMethod.ALL },
      )
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
