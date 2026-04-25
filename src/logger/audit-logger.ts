/**
 * Audit Logger
 * 
 * Specialized audit logging functionality that integrates with the existing audit system
 */

import { LoggerService } from './logger.service';
import { AuditLogEntry, LogLevel, LogCategory } from './logger.types';

export class AuditLogger {
  private logger: LoggerService;
  private static instance: AuditLogger;

  private constructor() {
    this.logger = LoggerService.getInstance();
  }

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /**
   * Log API request
   */
  async logApiRequest(data: {
    userId?: string;
    apiKeyId?: string;
    method: string;
    endpoint: string;
    statusCode: number;
    responseTime: number;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    error?: string;
  }): Promise<void> {
    await this.logger.audit({
      level: LogLevel.INFO,
      eventType: 'API_REQUEST',
      action: `${data.method} ${data.endpoint}`,
      resource: data.endpoint,
      outcome: data.statusCode < 400 ? 'success' : data.statusCode < 500 ? 'failure' : 'failure',
      userId: data.userId,
      apiKeyId: data.apiKeyId,
      requestId: data.requestId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      message: `API ${data.method} ${data.endpoint} - ${data.statusCode}`,
      metadata: {
        method: data.method,
        endpoint: data.endpoint,
        statusCode: data.statusCode,
        responseTime: data.responseTime,
        error: data.error,
      },
    });
  }

  /**
   * Log API key lifecycle events
   */
  async logApiKeyEvent(data: {
    userId: string;
    apiKeyId: string;
    action: 'created' | 'rotated' | 'revoked' | 'suspended' | 'reactivated';
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const eventTypeMap = {
      created: 'API_KEY_CREATED',
      rotated: 'API_KEY_ROTATED',
      revoked: 'API_KEY_REVOKED',
      suspended: 'API_KEY_SUSPENDED',
      reactivated: 'API_KEY_REACTIVATED',
    };

    await this.logger.audit({
      level: LogLevel.INFO,
      eventType: eventTypeMap[data.action],
      action: data.action,
      resource: `api-key:${data.apiKeyId}`,
      outcome: 'success',
      userId: data.userId,
      apiKeyId: data.apiKeyId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      message: `API key ${data.action}`,
      metadata: data.metadata,
    });
  }

  /**
   * Log gas transaction events
   */
  async logGasTransaction(data: {
    userId?: string;
    apiKeyId?: string;
    chainId: string;
    transactionHash?: string;
    gasUsed?: string;
    gasPrice?: string;
    action: 'estimate' | 'submit' | 'confirm' | 'fail';
    outcome: 'success' | 'failure' | 'partial';
    error?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const eventTypeMap = {
      estimate: 'GAS_ESTIMATE',
      submit: 'GAS_TRANSACTION_SUBMIT',
      confirm: 'GAS_TRANSACTION_CONFIRM',
      fail: 'GAS_TRANSACTION_FAIL',
    };

    await this.logger.audit({
      level: LogLevel.INFO,
      eventType: eventTypeMap[data.action],
      action: data.action,
      resource: `chain:${data.chainId}`,
      outcome: data.outcome,
      userId: data.userId,
      apiKeyId: data.apiKeyId,
      chainId: data.chainId,
      transactionHash: data.transactionHash,
      gasUsed: data.gasUsed,
      gasPrice: data.gasPrice,
      message: `Gas transaction ${data.action} on chain ${data.chainId}`,
      metadata: {
        ...data.metadata,
        error: data.error,
      },
    });
  }

  /**
   * Log security events
   */
  async logSecurityEvent(data: {
    userId?: string;
    apiKeyId?: string;
    action: string;
    resource: string;
    outcome: 'success' | 'failure';
    severity: 'low' | 'medium' | 'high' | 'critical';
    ipAddress?: string;
    userAgent?: string;
    reason?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.logger.audit({
      level: data.severity === 'critical' || data.severity === 'high' ? LogLevel.WARN : LogLevel.INFO,
      eventType: 'SECURITY_EVENT',
      action: data.action,
      resource: data.resource,
      outcome: data.outcome,
      userId: data.userId,
      apiKeyId: data.apiKeyId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      message: `Security event: ${data.action}`,
      metadata: {
        ...data.metadata,
        severity: data.severity,
        reason: data.reason,
      },
    });
  }

  /**
   * Log system events
   */
  async logSystemEvent(data: {
    action: string;
    resource: string;
    outcome: 'success' | 'failure';
    component: string;
    error?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.logger.audit({
      level: data.outcome === 'failure' ? LogLevel.ERROR : LogLevel.INFO,
      eventType: 'SYSTEM_EVENT',
      action: data.action,
      resource: data.resource,
      outcome: data.outcome,
      message: `System event: ${data.action} in ${data.component}`,
      metadata: {
        ...data.metadata,
        component: data.component,
        error: data.error,
      },
    });
  }

  /**
   * Log configuration changes
   */
  async logConfigurationChange(data: {
    userId?: string;
    action: 'create' | 'update' | 'delete';
    resource: string;
    oldValue?: any;
    newValue?: any;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.logger.audit({
      level: LogLevel.INFO,
      eventType: 'CONFIGURATION_CHANGE',
      action: data.action,
      resource: data.resource,
      outcome: 'success',
      userId: data.userId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      message: `Configuration ${data.action}: ${data.resource}`,
      metadata: {
        ...data.metadata,
        oldValue: data.oldValue,
        newValue: data.newValue,
      },
    });
  }

  /**
   * Log data access events
   */
  async logDataAccess(data: {
    userId?: string;
    apiKeyId?: string;
    action: 'read' | 'write' | 'delete' | 'export';
    resource: string;
    outcome: 'success' | 'failure';
    recordCount?: number;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.logger.audit({
      level: LogLevel.INFO,
      eventType: 'DATA_ACCESS',
      action: data.action,
      resource: data.resource,
      outcome: data.outcome,
      userId: data.userId,
      apiKeyId: data.apiKeyId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      message: `Data ${data.action}: ${data.resource}`,
      metadata: {
        ...data.metadata,
        recordCount: data.recordCount,
      },
    });
  }

  /**
   * Create a child logger with preset context
   */
  withContext(context: {
    userId?: string;
    apiKeyId?: string;
    sessionId?: string;
    requestId?: string;
  }): AuditLogger {
    const childLogger = new AuditLogger();
    (childLogger as any).logger = this.logger.withContext(context);
    return childLogger;
  }
}
