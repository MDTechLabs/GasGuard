import { Module, DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { GasPriceRecord } from './entities/gas-price-record.entity';
import { VolatilitySnapshot } from './entities/volatility-snapshot.entity';
import { GasDataAggregationService } from './gas-data-aggregation.service';
import { GasVolatilityService } from './gas-volatility.service';
import { GasVolatilityController } from './gas-volatility.controller';
import { GasVolatilityScheduler } from './gas-volatility.scheduler';
import { VolatilityEngine } from './volatility.engine';
import { JsonRpcGasProvider } from './providers/json-rpc-gas.provider';
import {
  GAS_DATA_PROVIDER,
  SUPPORTED_CHAINS,
  GasDataProvider,
} from './interfaces/gas-volatility.interfaces';

export interface GasVolatilityModuleOptions {
  /** EVM JSON-RPC URL (e.g. https://mainnet.infura.io/v3/<key>) */
  rpcUrl: string;
  /** Chain IDs to monitor, e.g. [1, 137, 42161] */
  supportedChains: number[];
  /** Optional: supply a custom GasDataProvider (useful for tests) */
  gasDataProvider?: GasDataProvider;
}

@Module({})
export class GasVolatilityModule {
  static forRoot(options: GasVolatilityModuleOptions): DynamicModule {
    const gasProviderToken = {
      provide: GAS_DATA_PROVIDER,
      useValue:
        options.gasDataProvider ?? new JsonRpcGasProvider(options.rpcUrl),
    };

    const supportedChainsToken = {
      provide: SUPPORTED_CHAINS,
      useValue: options.supportedChains,
    };

    return {
      module: GasVolatilityModule,
      imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([GasPriceRecord, VolatilitySnapshot]),
      ],
      controllers: [GasVolatilityController],
      providers: [
        gasProviderToken,
        supportedChainsToken,
        GasDataAggregationService,
        GasVolatilityService,
        GasVolatilityScheduler,
        VolatilityEngine,
      ],
      exports: [GasVolatilityService, GasDataAggregationService],
    };
  }
}
