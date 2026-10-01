import { ConfigService } from "@nestjs/config";

/**
 * Central retention policy for data categories covered by Issue #1011.
 * Defaults mirror the recommendations already published in
 * docs/AUDIT_LOGGING_SYSTEM.md and docs/DATABASE_BACKUP_RESTORE.md; override
 * per-environment via the listed env vars rather than editing these defaults.
 */
export interface RetentionPolicy {
  /** Audit log rows (audit_logs) older than this are purged. */
  auditLogRetentionDays: number;
  /** Analysis results (repositories/findings in analysis_results) older than this are purged. */
  analysisResultRetentionDays: number;
  /**
   * Maximum number of days a temporary working directory may remain on disk
   * before being reclaimed. This bounds the blast radius of any leaked or
   * orphaned temp directory created during analysis or backup operations.
   */
  tempDirectoryMaxAgeDays: number;
  /**
   * Maximum number of temporary working directories that may exist
   * concurrently. Exceeding this threshold indicates a leak and triggers
   * alerting + aggressive reclamation.
   */
  tempDirectoryMaxCount: number;
  /**
   * Whether temporary directories must be created with restrictive
   * permissions (0'0700) and owned by the service account. Secure by
   * default; only disable in local development if absolutely required.
   */
  tempDirectoryEnforcePermissions: boolean;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  auditLogRetentionDays: 90,
  analysisResultRetentionDays: 180,
  tempDirectoryMaxAgeDays: 1,
  tempDirectoryMaxCount: 1000,
  tempDirectoryEnforcePermissions: true,
};

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
export const MIN_TEMP_DIRECTORY_MAX_COUNT = 1;
export const MAX_TEMP_DIRECTORY_MAX_COUNT = 100000;

function parseBoundedInteger(
  value: unknown,
  defaultValue: number,
  name: string,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `Invalid retention policy value for ${name}: expected an integer, received ${String(
        value,
      )}`,
    );
  }

  if (parsed < min || parsed > max) {
    throw new Error(
      `Retention policy value for ${name} must be between ${min} and ${max}, received ${parsed}`,
    );
  }

  return parsed;
}

function parseBoolean(
  value: unknown,
  defaultValue: boolean,
  name: string,
): boolean {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `Invalid retention policy value for ${name}: expected a boolean, received ${String(
      value,
    )}`,
  );
}

export function getRetentionPolicy(config: ConfigService): RetentionPolicy {
  return {
    auditLogRetentionDays: parseBoundedInteger(
      config.get("AUDIT_LOG_RETENTION_DAYS"),
      DEFAULT_RETENTION_POLICY.auditLogRetentionDays,
      "AUDIT_LOG_RETENTION_DAYS",
      MIN_RETENTION_DAYS,
      MAX_RETENTION_DAYS,
    ),
    analysisResultRetentionDays: parseBoundedInteger(
      config.get("ANALYSIS_RESULT_RETENTION_DAYS"),
      DEFAULT_RETENTION_POLICY.analysisResultRetentionDays,
      "ANALYSIS_RESULT_RETENTION_DAYS",
      MIN_RETENTION_DAYS,
      MAX_RETENTION_DAYS,
    ),
    tempDirectoryMaxAgeDays: parseBoundedInteger(
      config.get("TEMP_DIRECTORY_MAX_AGE_DAYS"),
      DEFAULT_RETENTION_POLICY.tempDirectoryMaxAgeDays,
      "TEMP_DIRECTORY_MAX_AGE_DAYS",
      MIN_RETENTION_DAYS,
      MAX_RETENTION_DAYS,
    ),
    tempDirectoryMaxCount: parseBoundedInteger(
      config.get("TEMP_DIRECTORY_MAX_COUNT"),
      DEFAULT_RETENTION_POLICY.tempDirectoryMaxCount,
      "TEMP_DIRECTORY_MAX_COUNT",
      MIN_TEMP_DIRECTORY_MAX_COUNT,
      MAX_TEMP_DIRECTORY_MAX_COUNT,
    ),
    tempDirectoryEnforcePermissions: parseBoolean(
      config.get("TEMP_DIRECTORY_ENFORCE_PERMISSIONS"),
      DEFAULT_RETENTION_POLICY.tempDirectoryEnforcePermissions,
      "TEMP_DIRECTORY_ENFORCE_PERMISSIONS",
    ),
  };
}
