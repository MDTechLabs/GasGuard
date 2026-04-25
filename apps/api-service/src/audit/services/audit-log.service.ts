import { Injectable } from '@nestjs/common';
import { EventType, OutcomeStatus } from '../entities';
import { AuditLogRepository } from './audit-log.repository';
import { AuditEventEmitter, AuditEventPayload } from './audit-event-emitter';
import { 
  AuditLogFilterDto, 
  CreateAuditLogDto, 
  AuditLogsPageDto,
} from '../dto/audit-log.dto';

@Injectable()
export class AuditLogService {
  constructor(
    private readonly auditLogRepository: AuditLogRepository,
    private readonly auditEventEmitter: AuditEventEmitter,
  ) {
    // Listen to audit events and save them to database
    this.auditEventEmitter.onAuditEvent((payload) => {
      this.logEvent(payload).catch((error) => {
        console.error('Failed to log audit event:', error);
      });
    });
  }

  /**
   * Log an audit event
   */
  async logEvent(payload: AuditEventPayload): Promise<void> {
    const createDto: CreateAuditLogDto = {
      eventType: payload.eventType,
      user: payload.user,
      apiKey: payload.apiKey,
      chainId: payload.chainId,
      details: payload.details,
      outcome: payload.outcome,
      endpoint: payload.endpoint,
      httpMethod: payload.httpMethod,
      responseStatus: payload.responseStatus,
      ipAddress: payload.ipAddress,
      errorMessage: payload.errorMessage,
      responseDuration: payload.responseDuration,
    };

    await this.auditLogRepository.create(createDto);
  }

  /**
   * Query audit logs with filters
   */
  async queryLogs(filters: AuditLogFilterDto): Promise<AuditLogsPageDto> {
    return this.auditLogRepository.findWithFilters(filters);
  }

  /**
   * Get a single audit log by ID
   */
  async getLogById(id: string) {
    return this.auditLogRepository.findById(id);
  }

  /**
   * Get logs by event type
   */
  async getLogsByEventType(eventType: EventType, limit = 100) {
    return this.auditLogRepository.findByEventType(eventType, limit);
  }

  /**
   * Get logs by user
   */
  async getLogsByUser(user: string, limit = 100) {
    return this.auditLogRepository.findByUser(user, limit);
  }

  /**
   * Get logs by API key
   */
  async getLogsByApiKey(apiKey: string, limit = 100) {
    return this.auditLogRepository.findByApiKey(apiKey, limit);
  }

  /**
   * Get logs by chain
   */
  async getLogsByChain(chainId: number, limit = 100) {
    return this.auditLogRepository.findByChain(chainId, limit);
  }

  /**
   * Get logs by date range
   */
  async getLogsByDateRange(from: Date, to: Date, limit = 1000) {
    return this.auditLogRepository.findByDateRange(from, to, limit);
  }

  /**
   * Export logs as CSV or JSON
   */
  async exportLogs(
    format: 'csv' | 'json',
    filters?: AuditLogFilterDto,
  ): Promise<string> {
    const response = await this.auditLogRepository.findWithFilters(
      filters || { limit: 10000, offset: 0 },
    );

    if (format === 'json') {
      return JSON.stringify(response.data, null, 2);
    }

    if (format === 'csv') {
      // Simple CSV generation without external dependency
      const headers = [
        'id',
        'eventType',
        'timestamp',
        'user',
        'apiKey',
        'chainId',
        'outcome',
        'endpoint',
        'httpMethod',
        'responseStatus',
      ];
      
      const rows = response.data.map(row => 
        headers.map(h => JSON.stringify((row as any)[h] || '')).join(',')
      );
      
      return [headers.join(','), ...rows].join('\n');
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  /**
   * Clean up old logs (retention policy)
   */
  async retentionCleanup(retentionDays: number): Promise<number> {
    return this.auditLogRepository.deleteOlderThan(retentionDays);
  }

  /**
   * Emit API request event
   */
  emitApiRequest(
    apiKey: string,
    endpoint: string,
    method: string,
    status: number,
    ipAddress?: string,
    duration?: number,
    errorMessage?: string,
  ): void {
    this.auditEventEmitter.emitApiRequestEvent(
      apiKey,
      endpoint,
      method,
      status,
      ipAddress,
      duration,
      errorMessage,
    );
  }

  /**
   * Emit API key event
   */
  emitApiKeyEvent(
    eventType: EventType.API_KEY_CREATED | EventType.API_KEY_ROTATED | EventType.API_KEY_REVOKED,
    merchantId: string,
    details: Record<string, any>,
  ): void {
    this.auditEventEmitter.emitApiKeyEvent(eventType, merchantId, details);
  }

  /**
   * Emit gas transaction event
   */
  emitGasTransaction(
    merchantId: string,
    chainId: number,
    transactionHash: string,
    gasUsed: number,
    gasPrice: string,
    senderAddress: string,
    details?: Record<string, any>,
  ): void {
    this.auditEventEmitter.emitGasTransactionEvent(
      merchantId,
      chainId,
      transactionHash,
      gasUsed,
      gasPrice,
      senderAddress,
      details,
    );
  }

  /**
   * Emit configuration update event
   */
  emitConfigUpdate(
    adminUser: string,
    configType: string,
    changes: Record<string, any>,
    target?: string,
  ): void {
    this.auditEventEmitter.emitConfigUpdateEvent(adminUser, configType, changes, target);
  }

  /**
   * Emit role change event
   */
  emitRoleChange(
    adminUser: string,
    targetUser: string,
    action: 'grant' | 'revoke' | 'update',
    role: string,
    previousRole?: string,
  ): void {
    this.auditEventEmitter.emitRoleChangeEvent(adminUser, targetUser, action, role, previousRole);
  }

  /**
   * Emit treasury operation event
   */
  emitTreasuryOperation(
    adminUser: string,
    operation: string,
    amount?: string,
    asset?: string,
    recipient?: string,
    details?: Record<string, any>,
  ): void {
    this.auditEventEmitter.emitTreasuryOperationEvent(
      adminUser,
      operation,
      amount,
      asset,
      recipient,
      details,
    );
  }

  /**
   * Emit system administration event
   */
  emitSystemAdmin(
    adminUser: string,
    action: string,
    target: string,
    details?: Record<string, any>,
  ): void {
    this.auditEventEmitter.emitSystemAdminEvent(adminUser, action, target, details);
  }
}
