
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { PriceFeedService } from './price-feed.service';
import { FeeIndexerService } from './fee-indexer.service';
import { NetworkConfigService } from './network-config.service';

@Module({
    imports: [HttpModule, CacheModule.register()],
    providers: [PriceFeedService, FeeIndexerService, NetworkConfigService],
    exports: [PriceFeedService, FeeIndexerService],
})
export class GasOracleModule {}