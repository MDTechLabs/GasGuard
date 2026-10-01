export interface GasGuardConfig {
  contracts: string[];
  output?: "json" | "table";
  failOnHigh?: boolean;
  maxArchiveSizeBytes?: number;
  maxArchiveEntries?: number;
  maxUncompressedSizeBytes?: number;
}

export const DEFAULT_MAX_ARCHIVE_SIZE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MAX_ARCHIVE_ENTRIES = 10_000;
export const DEFAULT_MAX_UNCOMPRESSED_SIZE_BYTES = 500 * 1024 * 1024;

export interface ArchiveLimits {
  maxArchiveSizeBytes: number;
  maxArchiveEntries: number;
  maxUncompressedSizeBytes: number;
}

export interface ArchiveMetadata {
  archiveSizeBytes: number;
  entryCount: number;
  uncompressedSizeBytes: number;
}

export class ArchiveSizeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveSizeLimitError";
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export function validateConfig(config: unknown): GasGuardConfig {
  if (!config || typeof config !== "object") {
    throw new ConfigValidationError(
      "Invalid config: configuration must be an object",
    );
  }

  const parsed = config as GasGuardConfig;

  if (!Array.isArray(parsed.contracts)) {
    throw new ConfigValidationError(
      'Invalid config: "contracts" must be an array',
    );
  }

  if (parsed.contracts.length === 0) {
    throw new ConfigValidationError(
      "Invalid config: at least one contract is required",
    );
  }

  for (const contract of parsed.contracts) {
    if (typeof contract !== "string" || contract.trim() === "") {
      throw new ConfigValidationError(
        "Invalid config: all contract paths must be non-empty strings",
      );
    }
  }

  if (parsed.output && !["json", "table"].includes(parsed.output)) {
    throw new ConfigValidationError(
      'Invalid config: "output" must be either "json" or "table"',
    );
  }

  if (
    parsed.failOnHigh !== undefined &&
    typeof parsed.failOnHigh !== "boolean"
  ) {
    throw new ConfigValidationError(
      'Invalid config: "failOnHigh" must be a boolean',
    );
  }

  if (parsed.maxArchiveSizeBytes !== undefined) {
    if (
      typeof parsed.maxArchiveSizeBytes !== "number" ||
      !Number.isFinite(parsed.maxArchiveSizeBytes) ||
      !Number.isInteger(parsed.maxArchiveSizeBytes) ||
      parsed.maxArchiveSizeBytes <= 0
    ) {
      throw new ConfigValidationError(
        'Invalid config: "maxArchiveSizeBytes" must be a positive integer',
      );
    }
  }

  if (parsed.maxArchiveEntries !== undefined) {
    if (
      typeof parsed.maxArchiveEntries !== "number" ||
      !Number.isFinite(parsed.maxArchiveEntries) ||
      !Number.isInteger(parsed.maxArchiveEntries) ||
      parsed.maxArchiveEntries <= 0
    ) {
      throw new ConfigValidationError(
        'Invalid config: "maxArchiveEntries" must be a positive integer',
      );
    }
  }

  if (parsed.maxUncompressedSizeBytes !== undefined) {
    if (
      typeof parsed.maxUncompressedSizeBytes !== "number" ||
      !Number.isFinite(parsed.maxUncompressedSizeBytes) ||
      !Number.isInteger(parsed.maxUncompressedSizeBytes) ||
      parsed.maxUncompressedSizeBytes <= 0
    ) {
      throw new ConfigValidationError(
        'Invalid config: "maxUncompressedSizeBytes" must be a positive integer',
      );
    }
  }

  return parsed;
}

export function resolveArchiveLimits(config: GasGuardConfig): ArchiveLimits {
  return {
    maxArchiveSizeBytes:
      config.maxArchiveSizeBytes ?? DEFAULT_MAX_ARCHIVE_SIZE_BYTES,
    maxArchiveEntries:
      config.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES,
    maxUncompressedSizeBytes:
      config.maxUncompressedSizeBytes ?? DEFAULT_MAX_UNCOMPRESSED_SIZE_BYTES,
  };
}

export function validateArchiveSize(
  metadata: ArchiveMetadata,
  limits: ArchiveLimits,
): void {
  if (
    !Number.isFinite(metadata.archiveSizeBytes) ||
    metadata.archiveSizeBytes < 0
  ) {
    throw new ArchiveSizeLimitError(
      "Invalid archive metadata: archiveSizeBytes must be a non-negative number",
    );
  }

  if (metadata.archiveSizeBytes > limits.maxArchiveSizeBytes) {
    throw new ArchiveSizeLimitError(
      `Archive size ${metadata.archiveSizeBytes} bytes exceeds limit of ${limits.maxArchiveSizeBytes} bytes`,
    );
  }

  if (metadata.entryCount > limits.maxArchiveEntries) {
    throw new ArchiveSizeLimitError(
      `Archive entry count ${metadata.entryCount} exceeds limit of ${limits.maxArchiveEntries}`,
    );
  }

  if (metadata.uncompressedSizeBytes > limits.maxUncompressedSizeBytes) {
    throw new ArchiveSizeLimitError(
      `Archive uncompressed size ${metadata.uncompressedSizeBytes} bytes exceeds limit of ${limits.maxUncompressedSizeBytes} bytes`,
    );
  }
}
