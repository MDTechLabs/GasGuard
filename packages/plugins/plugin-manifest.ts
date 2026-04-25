/**
 * Plugin manifest and metadata types
 * Defines the standard plugin publishing format
 */

/**
 * Semantic version string (e.g., "1.2.3")
 */
export type SemanticVersion = string;

/**
 * Plugin severity level
 */
export enum PluginSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Supported programming languages for analysis
 */
export enum SupportedLanguage {
  SOLIDITY = 'solidity',
  RUST = 'rust',
  VYPER = 'vyper',
  PYTHON = 'python',
  JAVASCRIPT = 'javascript',
  TYPESCRIPT = 'typescript',
}

/**
 * Plugin capability category
 */
export enum PluginCapability {
  GAS_OPTIMIZATION = 'gas-optimization',
  SECURITY_ANALYSIS = 'security-analysis',
  CODE_QUALITY = 'code-quality',
  PERFORMANCE = 'performance',
  COMPATIBILITY = 'compatibility',
  CUSTOM = 'custom',
}

/**
 * Version compatibility specification
 */
export interface VersionRange {
  /** Minimum compatible version (inclusive) */
  min: SemanticVersion;
  /** Maximum compatible version (exclusive) */
  max?: SemanticVersion;
  /** Specific incompatible versions */
  excludeVersions?: SemanticVersion[];
}

/**
 * Dependency specification for a plugin
 */
export interface PluginDependency {
  /** Plugin ID or package name */
  pluginId: string;
  /** Version range requirement */
  versionRange: VersionRange;
  /** Is dependency optional */
  optional?: boolean;
}

/**
 * Plugin contact information
 */
export interface ContactInfo {
  name?: string;
  email?: string;
  url?: string;
}

/**
 * Plugin repository information
 */
export interface RepositoryInfo {
  type: 'git' | 'svn' | 'hg' | 'pijul';
  url: string;
  directory?: string;
}

/**
 * Plugin funding/sponsorship information
 */
export interface FundingInfo {
  type: string; // 'patreon', 'github', 'opencollective', etc.
  url: string;
}

/**
 * Plugin manifest (plugin.json)
 * Standard format for plugin distribution
 */
export interface PluginManifest {
  // === REQUIRED ===

  /** Unique plugin identifier (lowercase, hyphen-separated) */
  id: string;

  /** Human-readable plugin name */
  name: string;

  /** Semantic version (e.g., "1.0.0") */
  version: SemanticVersion;

  /** Plugin description */
  description: string;

  /** Supported languages for analysis */
  languages: SupportedLanguage[];

  /** Plugin capabilities/categories */
  capabilities: PluginCapability[];

  /** Main entry point (compiled .so, .dll, or .wasm path) */
  main: string;

  // === RECOMMENDED ===

  /** Plugin author information */
  author?: ContactInfo;

  /** Plugin license (SPDX identifier, e.g., "MIT", "Apache-2.0") */
  license?: string;

  /** Plugin homepage/documentation URL */
  homepage?: string;

  /** Repository information */
  repository?: RepositoryInfo;

  /** Bug reporting URL */
  bugs?: string | { url: string; email?: string };

  /** Keywords for discovery */
  keywords?: string[];

  // === VERSIONING & COMPATIBILITY ===

  /** Minimum required GasGuard core version */
  gasguardVersion: VersionRange;

  /** Dependencies on other plugins */
  dependencies?: Record<string, PluginDependency>;

  /** Peer dependencies (should exist, but not required) */
  peerDependencies?: Record<string, VersionRange>;

  /** Conflicting plugin IDs */
  conflicts?: string[];

  // === PLUGIN METADATA ===

  /** Minimum rule severity level */
  minSeverity?: PluginSeverity;

  /** Maximum rule severity level */
  maxSeverity?: PluginSeverity;

  /** Configuration schema (JSON Schema) */
  configSchema?: Record<string, any>;

  /** Default configuration */
  defaultConfig?: Record<string, any>;

  /** Human-readable rule categories/groups */
  ruleGroups?: string[];

  // === DISTRIBUTION & SUPPORT ===

  /** Sponsorship/funding information */
  funding?: FundingInfo[];

  /** Plugin status */
  status?: 'stable' | 'beta' | 'alpha' | 'deprecated';

  /** Deprecation message if deprecated */
  deprecationMessage?: string;

  /** Changelog URL */
  changelogUrl?: string;

  /** Support contact */
  support?: ContactInfo;

  // === FILES & METADATA ===

  /** Files included in the plugin package */
  files?: string[];

  /** README file path */
  readme?: string;

  /** Excluded files from package */
  ignore?: string[];

  /** Metadata about the built plugin */
  meta?: {
    buildDate: string;
    buildVersion: string;
    compiler?: string;
    compilerVersion?: string;
  };
}

/**
 * Basic plugin package structure (for analysis before manifest)
 */
export interface PluginPackage {
  manifest: PluginManifest;
  mainPath: string;
  files: Map<string, Uint8Array>;
  checksums?: Record<string, string>;
}

/**
 * Plugin registry entry with resolved dependencies
 */
export interface PluginRegistryEntry {
  manifest: PluginManifest;
  resolvedDependencies: Map<string, PluginManifest>;
  compatibilityStatus: CompatibilityStatus[];
  loadedAt: Date;
  location: string; // File path or registry URL
}

/**
 * Compatibility check result
 */
export interface CompatibilityStatus {
  type: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  details?: any;
}

/**
 * Plugin metadata for discovery/listing
 */
export interface PluginDiscoveryInfo {
  id: string;
  name: string;
  version: SemanticVersion;
  description: string;
  author?: string;
  homepage?: string;
  downloads?: number;
  rating?: number;
  lastUpdated: Date;
  status: string;
  compatible: boolean;
}
