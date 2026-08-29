/**
 * Cache Module
 * Integrates caching into the application
 */
import { Module } from "@nestjs/common";
import { CacheService } from "./cache.service";
import { CacheMetricsService } from "./cache-metrics.service";

export interface OnModuleInit {
  onModuleInit(): Promise<void>;
}

@Module({
  providers: [CacheService, CacheMetricsService],
  exports: [CacheService, CacheMetricsService],
})
export class CacheModule {
  constructor(private cacheService: CacheService) {}

  async onModuleInit() {
    await this.cacheService.initialize();
  }
}
