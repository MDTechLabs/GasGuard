/**
 * Logger Configuration
 * 
 * Centralized configuration for the logging system
 */

import { LogLevel, LoggerConfig } from './logger.types';

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  enableConsole: true,
  enableFile: true,
  enableAudit: true,
  filePath: './logs',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 100,
  dateFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
  enableColors: true,
  enableStackTrace: true,
  auditRetentionDays: 365,
  compressionEnabled: true,
};

export class LoggerConfigManager {
  private static instance: LoggerConfigManager;
  private config: LoggerConfig;

  private constructor() {
    this.config = { ...DEFAULT_LOGGER_CONFIG };
    this.loadFromEnvironment();
  }

  static getInstance(): LoggerConfigManager {
    if (!LoggerConfigManager.instance) {
      LoggerConfigManager.instance = new LoggerConfigManager();
    }
    return LoggerConfigManager.instance;
  }

  private loadFromEnvironment(): void {
    // Environment variable overrides
    if (process.env.LOG_LEVEL) {
      this.config.level = process.env.LOG_LEVEL as LogLevel;
    }
    
    if (process.env.LOG_ENABLE_CONSOLE) {
      this.config.enableConsole = process.env.LOG_ENABLE_CONSOLE === 'true';
    }
    
    if (process.env.LOG_ENABLE_FILE) {
      this.config.enableFile = process.env.LOG_ENABLE_FILE === 'true';
    }
    
    if (process.env.LOG_ENABLE_AUDIT) {
      this.config.enableAudit = process.env.LOG_ENABLE_AUDIT === 'true';
    }
    
    if (process.env.LOG_FILE_PATH) {
      this.config.filePath = process.env.LOG_FILE_PATH;
    }
    
    if (process.env.LOG_MAX_FILE_SIZE) {
      this.config.maxFileSize = parseInt(process.env.LOG_MAX_FILE_SIZE, 10);
    }
    
    if (process.env.LOG_MAX_FILES) {
      this.config.maxFiles = parseInt(process.env.LOG_MAX_FILES, 10);
    }
    
    if (process.env.LOG_AUDIT_RETENTION_DAYS) {
      this.config.auditRetentionDays = parseInt(process.env.LOG_AUDIT_RETENTION_DAYS, 10);
    }
    
    if (process.env.LOG_ENABLE_COLORS) {
      this.config.enableColors = process.env.LOG_ENABLE_COLORS === 'true';
    }
    
    if (process.env.LOG_ENABLE_STACK_TRACE) {
      this.config.enableStackTrace = process.env.LOG_ENABLE_STACK_TRACE === 'true';
    }
    
    if (process.env.LOG_COMPRESSION_ENABLED) {
      this.config.compressionEnabled = process.env.LOG_COMPRESSION_ENABLED === 'true';
    }
  }

  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  resetToDefaults(): void {
    this.config = { ...DEFAULT_LOGGER_CONFIG };
    this.loadFromEnvironment();
  }

  isLevelEnabled(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.FATAL];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const checkLevelIndex = levels.indexOf(level);
    return checkLevelIndex >= currentLevelIndex;
  }
}
