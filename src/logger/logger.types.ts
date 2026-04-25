/**
 * Logger Types and Interfaces
 * 
 * Defines the core types and interfaces for the centralized logging system
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

export enum LogCategory {
  SYSTEM = 'system',
  AUDIT = 'audit',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  BUSINESS = 'business',
  NETWORK = 'network',
  DATABASE = 'database'
}

export interface LogEntry {
  id?: string;
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
  metadata?: Record<string, any>;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
  };
  tags?: string[];
  correlationId?: string;
}

export interface AuditLogEntry extends LogEntry {
  category: LogCategory.AUDIT;
  eventType: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure' | 'partial';
  ipAddress?: string;
  userAgent?: string;
  apiKeyId?: string;
  chainId?: string;
  transactionHash?: string;
  gasUsed?: string;
  gasPrice?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  enableAudit: boolean;
  filePath?: string;
  maxFileSize?: number;
  maxFiles?: number;
  dateFormat?: string;
  enableColors?: boolean;
  enableStackTrace?: boolean;
  auditRetentionDays?: number;
  compressionEnabled?: boolean;
}

export interface LogFilter {
  levels?: LogLevel[];
  categories?: LogCategory[];
  userId?: string;
  sessionId?: string;
  requestId?: string;
  startTime?: Date;
  endTime?: Date;
  tags?: string[];
  messagePattern?: string;
}

export interface LogSearchResult {
  entries: LogEntry[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface LoggerMetrics {
  totalLogs: number;
  logsByLevel: Record<LogLevel, number>;
  logsByCategory: Record<LogCategory, number>;
  errorRate: number;
  averageLogSize: number;
  storageUsage: number;
  lastLogTimestamp?: Date;
}

export interface ILogger {
  debug(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  error(message: string, error?: Error, metadata?: Record<string, any>): void;
  fatal(message: string, error?: Error, metadata?: Record<string, any>): void;
  audit(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'category'>): Promise<void>;
  setContext(context: Partial<LogEntry>): void;
  clearContext(): void;
  withContext(context: Partial<LogEntry>): ILogger;
}

export interface ILoggerProvider {
  write(entry: LogEntry): Promise<void>;
  query(filter: LogFilter, limit?: number, offset?: number): Promise<LogSearchResult>;
  getMetrics(): Promise<LoggerMetrics>;
  cleanup(retentionDays: number): Promise<number>;
}
