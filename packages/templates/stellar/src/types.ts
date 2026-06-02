/** Available Soroban contract template types. */
export type TemplateKind = "token" | "counter" | "nft" | "multisig";

/** Options passed to the template generator. */
export interface GeneratorOptions {
  /** Template kind to generate. */
  kind: TemplateKind;
  /** Contract name used to replace {{CONTRACT_NAME}} placeholders. */
  contractName: string;
  /** Directory where the generated file will be written. Defaults to cwd. */
  outputDir?: string;
  /** Overwrite an existing file without error. Default false. */
  overwrite?: boolean;
}

/** Metadata describing each available template. */
export interface TemplateMetadata {
  kind: TemplateKind;
  /** Short human-readable title. */
  title: string;
  /** Longer explanation of what this template does. */
  description: string;
  /** Secure defaults included in the template. */
  secureDefaults: string[];
  /** File name written by the generator (before contract name substitution). */
  fileName: string;
}

/** Result returned by the generator after successfully writing a file. */
export interface GenerateResult {
  /** Absolute path of the generated file. */
  filePath: string;
  /** Template kind that was used. */
  kind: TemplateKind;
  /** Contract name embedded in the output. */
  contractName: string;
}

/** A single validation issue found in a template. */
export interface ValidationIssue {
  /** Short identifier. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Severity level. */
  severity: "error" | "warning" | "info";
}

/** Validation result returned by the template validator. */
export interface ValidationResult {
  /** Whether the template passes all error-level checks. */
  valid: boolean;
  /** List of issues found (may include warnings/info). */
  issues: ValidationIssue[];
}
