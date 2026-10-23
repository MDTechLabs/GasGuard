import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RegisterWebhookDto, UpdateWebhookDto, AlertConfigDto } from './gas-spike-alert.dto';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { GasMonitorService } from './gas-monitor.service';
import { SpikeClassifierService } from './spike-classifier.service';

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly dispatcher: WebhookDispatcherService,
    private readonly monitor: GasMonitorService,
    private readonly classifier: SpikeClassifierService,
  ) {}

  // ─── Webhook Endpoints ────────────────────────────────────────────

  /**
   * POST /alerts/webhook
   * Register a new webhook subscription.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.CREATED)
  registerWebhook(@Body() dto: RegisterWebhookDto) {
    const subscription = this.dispatcher.register(dto);
    // Return subscription with secret visible only at creation time
    return {
      message: 'Webhook registered successfully. Save your secret — it will not be shown again.',
      subscription,
    };
  }

  /**
   * GET /alerts/webhook
   * List all webhook subscriptions (secrets redacted).
   */
  @Get('webhook')
  listWebhooks() {
    const subscriptions = this.dispatcher.list().map((sub) => ({
      ...sub,
      secret: '***redacted***',
    }));
    return { subscriptions };
  }

  // ─── Dead-Letter Endpoints (#1243) ────────────────────────────────
  // Registered before the generic `webhook/:id` routes below: Nest/Express
  // match routes in registration order, and `webhook/dead-letter` would
  // otherwise be captured by `webhook/:id` with id="dead-letter".

  /**
   * GET /alerts/webhook/dead-letter
   * List deliveries that exhausted all retries, optionally filtered by
   * subscription (?subscriptionId=...).
   */
  @Get('webhook/dead-letter')
  listDeadLetters(@Query('subscriptionId') subscriptionId?: string) {
    return { entries: this.dispatcher.listDeadLetters(subscriptionId) };
  }

  /**
   * GET /alerts/webhook/dead-letter/:id
   */
  @Get('webhook/dead-letter/:id')
  getDeadLetter(@Param('id') id: string) {
    return this.dispatcher.getDeadLetter(id);
  }

  /**
   * POST /alerts/webhook/dead-letter/:id/replay
   * Re-attempt one dead-lettered delivery against the subscription's
   * current URL/secret. Removed from the queue on success.
   */
  @Post('webhook/dead-letter/:id/replay')
  async replayDeadLetter(@Param('id') id: string) {
    return this.dispatcher.replayDeadLetter(id);
  }

  /**
   * POST /alerts/webhook/dead-letter/replay
   * Replay every dead-lettered delivery, optionally scoped to one
   * subscription via { "subscriptionId": "..." } in the body.
   */
  @Post('webhook/dead-letter/replay')
  async replayAllDeadLetters(@Body() body: { subscriptionId?: string }) {
    const results = await this.dispatcher.replayAllDeadLetters(body?.subscriptionId);
    return {
      replayed: results.length,
      succeeded: results.filter((r) => r.succeeded).length,
      results,
    };
  }

  /**
   * DELETE /alerts/webhook/dead-letter/:id
   * Permanently discard a dead-lettered delivery without replaying it.
   */
  @Delete('webhook/dead-letter/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  discardDeadLetter(@Param('id') id: string): void {
    this.dispatcher.discardDeadLetter(id);
  }

  /**
   * GET /alerts/webhook/:id
   * Get a single subscription (secret redacted).
   */
  @Get('webhook/:id')
  getWebhook(@Param('id') id: string) {
    const sub = this.dispatcher.findById(id);
    return { ...sub, secret: '***redacted***' };
  }

  /**
   * PATCH /alerts/webhook/:id
   * Update a subscription (URL, chainIds, minSeverity, active flag).
   */
  @Patch('webhook/:id')
  updateWebhook(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    const updated = this.dispatcher.update(id, dto);
    return { ...updated, secret: '***redacted***' };
  }

  /**
   * DELETE /alerts/webhook/:id
   */
  @Delete('webhook/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteWebhook(@Param('id') id: string): void {
    this.dispatcher.delete(id);
  }

  // ─── Monitoring Endpoints ─────────────────────────────────────────

  /**
   * GET /alerts/chains
   * Return the list of chains currently being monitored.
   */
  @Get('chains')
  getTrackedChains() {
    return { chains: this.monitor.getTrackedChains() };
  }

  /**
   * POST /alerts/chains/:chainId
   * Start tracking a chain.
   */
  @Post('chains/:chainId')
  @HttpCode(HttpStatus.CREATED)
  trackChain(@Param('chainId') chainId: string) {
    this.monitor.trackChain(parseInt(chainId, 10));
    return { message: `Chain ${chainId} is now being monitored` };
  }

  /**
   * DELETE /alerts/chains/:chainId
   * Stop tracking a chain.
   */
  @Delete('chains/:chainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  untrackChain(@Param('chainId') chainId: string): void {
    this.monitor.untrackChain(parseInt(chainId, 10));
  }

  /**
   * POST /alerts/trigger/:chainId
   * Manually trigger a monitoring tick for a specific chain (admin use).
   */
  @Post('trigger/:chainId')
  async triggerManualCheck(@Param('chainId') chainId: string) {
    const id = parseInt(chainId, 10);
    this.monitor.trackChain(id);
    await this.monitor.tick();
    const lastAlert = this.monitor.getLastAlert(id);
    return {
      message: `Manual check triggered for chain ${chainId}`,
      alert: lastAlert ?? null,
    };
  }

  /**
   * GET /alerts/status/:chainId
   * Get the most recent alert for a chain.
   */
  @Get('status/:chainId')
  getChainStatus(@Param('chainId') chainId: string) {
    const id = parseInt(chainId, 10);
    const lastAlert = this.monitor.getLastAlert(id);
    const history = this.classifier.getHistory(id);
    return {
      chainId: id,
      lastAlert: lastAlert ?? null,
      historyPoints: history.length,
      latestSnapshot: history[history.length - 1] ?? null,
    };
  }

  // ─── Configuration Endpoints ──────────────────────────────────────

  /**
   * PUT /alerts/config
   * Override threshold configuration (globally or per chain).
   */
  @Put('config')
  setConfig(@Body() dto: AlertConfigDto) {
    this.classifier.setCustomThresholds(dto);
    return {
      message: `Threshold configuration updated${dto.chainId ? ` for chain ${dto.chainId}` : ' globally'}`,
      config: dto,
    };
  }
}
