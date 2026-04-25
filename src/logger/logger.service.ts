/**
 * Logger Service
 * 
 * Main logging service implementation with multi-provider support
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { 
  ILogger, 
  LogEntry, 
  AuditLogEntry, 
  LogLevel, 
  LogCategory, 
  LogFilter, 
  LogSearchResult, 
  LoggerMetrics,
  ILoggerProvider 
} from './logger.types';
import { LoggerConfigManager } from './logger.config';

export class LoggerService extends EventEmitter implements ILogger {
  private static instance: LoggerService;
  private providers: Map<string, ILoggerProvider> = new Map();
  private context: Partial<LogEntry> = {};
  private configManager: LoggerConfigManager;

  private constructor() {
    super();
    this.configManager = LoggerConfigManager.getInstance();
  }

  static getInstance(): LoggerService {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  /**
   * Register a logging provider
   */
  registerProvider(name: string, provider: ILoggerProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Remove a logging provider
   */
  unregisterProvider(name: string): void {
    this.providers.delete(name);
  }

  /**
   * Get registered providers
   */
  getProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  private createLogEntry(
    level: LogLevel, 
    message: string, 
    metadata?: Record<string, any>
  ): LogEntry {
    return {
      id: randomUUID(),
      timestamp: new Date(),
      level,
      category: LogCategory.SYSTEM,
      message,
      metadata,
      ...this.context,
    };
  }

  private async writeLog(entry: LogEntry): Promise<void> {
    if (!this.configManager.isLevelEnabled(entry.level)) {
      return;
    }

    // Emit log event for real-time monitoring
    this.emit('log', entry);

    // Write to all registered providers
    const writePromises = Array.from(this.providers.values()).map(provider => 
      provider.write(entry).catch(error => {
        // Prevent infinite loops by logging provider errors to console only
        console.error('Logger provider error:', error);
      })
    );

    await Promise.allSettled(writePromises);
  }

  debug(message: string, metadata?: Record<string, any>): void {
    const entry = this.createLogEntry(LogLevel.DEBUG, message, metadata);
    this.writeLog(entry);
  }

  info(message: string, metadata?: Record<string, any>): void {
    const entry = this.createLogEntry(LogLevel.INFO, message, metadata);
    this.writeLog(entry);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    const entry = this.createLogEntry(LogLevel.WARN, message, metadata);
    this.writeLog(entry);
  }

  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    const entry = this.createLogEntry(LogLevel.ERROR, message, {
      ...metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      } : undefined,
    });
    this.writeLog(entry);
  }

  fatal(message: string, error?: Error, metadata?: Record<string, any>): void {
    const entry = this.createLogEntry(LogLevel.FATAL, message, {
      ...metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      } : undefined,
    });
    this.writeLog(entry);
  }

  async audit(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'category'>): Promise<void> {
    const auditEntry: AuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date(),
      category: LogCategory.AUDIT,
      ...entry,
    };

    // Emit audit event for real-time monitoring
    this.emit('audit', auditEntry);

    // Write to all registered providers
    const writePromises = Array.from(this.providers.values()).map(provider => 
      provider.write(auditEntry).catch(error => {
        console.error('Audit provider error:', error);
      })
    );

    await Promise.allSettled(writePromises);
  }

  setContext(context: Partial<LogEntry>): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  withContext(context: Partial<LogEntry>): ILogger {
    const logger = new LoggerService();
    logger.providers = this.providers;
    logger.context = { ...this.context, ...context };
    return logger;
  }

  /**
   * Query logs from all providers
   */
  async query(filter: LogFilter, limit = 100, offset = 0): Promise<LogSearchResult> {
    const results: LogSearchResult[] = [];
    
    for (const provider of this.providers.values()) {
      try {
        const result = await provider.query(filter, limit, offset);
        results.push(result);
      } catch (error) {
        console.error('Error querying provider:', error);
      }
    }

    // Merge results from all providers
    const allEntries = results.flatMap(r => r.entries);
    const sortedEntries = allEntries.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return {
      entries: sortedEntries.slice(0, limit),
      total: sortedEntries.length,
      hasMore: sortedEntries.length > limit,
    };
  }

  /**
   * Get metrics from all providers
   */
  async getMetrics(): Promise<LoggerMetrics> {
    const metricsList: LoggerMetrics[] = [];
    
    for (const provider of this.providers.values()) {
      try {
        const metrics = await provider.getMetrics();
        metricsList.push(metrics);
      } catch (error) {
        console.error('Error getting metrics from provider:', error);
      }
    }

    // Aggregate metrics from all providers
    const aggregated: LoggerMetrics = {
      totalLogs: 0,
      logsByLevel: {} as Record<LogLevel, number>,
      logsByCategory: {} as Record<LogCategory, number>,
      errorRate: 0,
      averageLogSize: 0,
      storageUsage: 0,
      lastLogTimestamp: undefined,
    };

    for (const metrics of metricsList) {
      aggregated.totalLogs += metrics.totalLogs;
      aggregated.storageUsage += metrics.storageUsage;
      
      // Aggregate logs by level
      Object.entries(metrics.logsByLevel).forEach(([level, count]) => {
        aggregated.logsByLevel[level as LogLevel] = 
          (aggregated.logsByLevel[level as LogLevel] || 0) + count;
      });
      
      // Aggregate logs by category
      Object.entries(metrics.logsByCategory).forEach(([category, count]) => {
        aggregated.logsByCategory[category as LogCategory] = 
          (aggregated.logsByCategory[category as LogCategory] || 0) + count;
      });
      
      // Update latest timestamp
      if (!aggregated.lastLogTimestamp || 
          (metrics.lastLogTimestamp && metrics.lastLogTimestamp.getTime() > aggregated.lastLogTimestamp.getTime())) {
        aggregated.lastLogTimestamp = metrics.lastLogTimestamp;
      }
    }

    // Calculate error rate
    const totalErrorLogs = aggregated.logsByLevel[LogLevel.ERROR] + aggregated.logsByLevel[LogLevel.FATAL];
    aggregated.errorRate = aggregated.totalLogs > 0 ? totalErrorLogs / aggregated.totalLogs : 0;

    return aggregated;
  }

  /**
   * Clean up old logs from all providers
   */
  async cleanup(retentionDays?: number): Promise<number> {
    const config = this.configManager.getConfig();
    const days = retentionDays ?? config.auditRetentionDays;
    let totalDeleted = 0;
    
    for (const provider of this.providers.values()) {
      try {
        const deleted = await provider.cleanup(days!);
        totalDeleted += deleted;
      } catch (error) {
        console.error('Error cleaning up provider:', error);
      }
    }

    return totalDeleted;
  }
}
