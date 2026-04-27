import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { ExampleController } from './example/example.controller';
import { FailedTransactionController } from './controllers/failed-transaction.controller';
import { CrossChainGasController } from './controllers/cross-chain-gas.controller';
import { FailedTransactionService } from './services/failed-transaction.service';
import { MitigationService } from './services/mitigation.service';
import { TransactionAnalysisService } from './services/transaction-analysis.service';
import { CrossChainGasService } from './services/cross-chain-gas.service';
import { RateLimitingModule, RateLimitGuard } from './rate-limiting';
import { AuthModule, JwtAuthGuard, RolesGuard } from './auth';
import { ExportsModule } from './exports/exports.module';
import { ScanModule } from './modules/scan/scan.module';

@Module({
     imports: [
         // Global configuration module for environment variables
         ConfigModule.forRoot({
             isGlobal: true,
             envFilePath: ['.env', '.env.local'],
         }),
         ThrottlerModule.forRoot([
             {
                 name: 'default',
                 ttl: 60000,  // 60 seconds in milliseconds
                 limit: 100,  // 100 requests per TTL window (generous fallback)
             },
         ]),
         // JWT Authentication module
         AuthModule,
         // New Redis-based rate limiting module
         RateLimitingModule.forRoot(),
         // Gas usage CSV export module
         ExportsModule,
         // Scan module for code analysis
         ScanModule,
     ],
    controllers: [
        AppController,
        ExampleController,
        FailedTransactionController,
        CrossChainGasController,
        // Add your controllers here - remember to add @Version('1') decorator
    ],
    providers: [
        // Apply RateLimitGuard globally for per-API key rate limiting
        {
            provide: APP_GUARD,
            useClass: RateLimitGuard,
        },
        // Apply JWT authentication guard globally to all routes
        {
            provide: APP_GUARD,
            useClass: JwtAuthGuard,
        },
        // Apply roles guard globally for RBAC enforcement
        {
            provide: APP_GUARD,
            useClass: RolesGuard,
        },
        FailedTransactionService,
        MitigationService,
        TransactionAnalysisService,
        CrossChainGasService,
    ],
})
export class AppModule { }
