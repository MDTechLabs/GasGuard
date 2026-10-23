import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { GasMonitorService } from './gas-monitor.service';
import { SpikeClassifierService } from './spike-classifier.service';
import { ThresholdEngineService } from './threshold-engine.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { WebhookDeadLetterService } from './webhook-dead-letter.service';

/**
 * GasSpikeAlertModule
 * ───────────────────
 * Self-contained module providing:
 *
 *  • Continuous gas price monitoring across multiple chains
 *  • Configurable threshold evaluation (%, absolute, volatility, priority fee)
 *  • Severity-based spike classification (Info / Warning / Critical)
 *  • Webhook fan-out with HMAC-signed payloads and retry back-off
 *  • Dead-letter queue + replay for deliveries that exhaust retries (#1243)
 *  • REST endpoints for webhook management and threshold configuration
 *
 * Usage in AppModule:
 *
 *   @Module({ imports: [GasSpikeAlertModule] })
 *   export class AppModule {}
 */
@Module({
  controllers: [AlertsController],
  providers: [
    GasMonitorService,
    SpikeClassifierService,
    ThresholdEngineService,
    WebhookDispatcherService,
    WebhookDeadLetterService,
  ],
  exports: [
    GasMonitorService,
    SpikeClassifierService,
    ThresholdEngineService,
    WebhookDispatcherService,
    WebhookDeadLetterService,
  ],
})
export class GasSpikeAlertModule {}
