import { ValidationIssue, ValidationResult } from "./types";

// ── Security patterns ─────────────────────────────────────────────────────────

/**
 * Patterns that MUST be present in a valid Soroban contract template.
 */
const REQUIRED_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  message: string;
  severity: ValidationIssue["severity"];
}> = [
  {
    pattern: /#!\[no_std\]/,
    code: "NO_STD_MISSING",
    message: "Soroban contracts must declare `#![no_std]`.",
    severity: "error",
  },
  {
    pattern: /use soroban_sdk::/,
    code: "SOROBAN_SDK_MISSING",
    message: "Contract must import from `soroban_sdk`.",
    severity: "error",
  },
  {
    pattern: /#\[contract\]/,
    code: "CONTRACT_MACRO_MISSING",
    message: "Contract struct must be annotated with `#[contract]`.",
    severity: "error",
  },
  {
    pattern: /#\[contractimpl\]/,
    code: "CONTRACTIMPL_MISSING",
    message: "Implementation block must be annotated with `#[contractimpl]`.",
    severity: "error",
  },
  {
    pattern: /\.require_auth\(\)/,
    code: "REQUIRE_AUTH_MISSING",
    message:
      "No `require_auth()` call found. All state-mutating functions must authorise the caller.",
    severity: "error",
  },
];

/**
 * Patterns that MUST NOT be present in a valid Soroban contract template.
 */
const FORBIDDEN_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  message: string;
  severity: ValidationIssue["severity"];
}> = [
  {
    pattern: /\bunwrap\(\)/,
    code: "UNSAFE_UNWRAP",
    message:
      'Avoid `.unwrap()` — use `.expect("…")` with a descriptive message or handle the `None` case explicitly.',
    severity: "warning",
  },
  {
    pattern: /panic!\(\s*"[^"]*"\s*\)/,
    code: "BARE_PANIC",
    message:
      "Prefer `assert!` or structured error types over bare `panic!` for better diagnostics.",
    severity: "info",
  },
  {
    // Detect raw integer arithmetic that could overflow (+, -, *) without
    // checked_* or saturating_* equivalents, only for i128/u64/u32 literals.
    pattern: /\b(i128|u64|u32|u128)\b[^;]*[^._][\+\-\*][^=][^;]*;/,
    code: "UNCHECKED_ARITHMETIC",
    message:
      "Potential unchecked arithmetic detected. Prefer `checked_add`, `checked_sub`, or `saturating_*` methods.",
    severity: "warning",
  },
  {
    pattern: /std::collections::/,
    code: "STD_COLLECTIONS",
    message:
      "Do not use `std::collections`. Use Soroban SDK types (`Map`, `Vec`) instead.",
    severity: "error",
  },
];

/**
 * Patterns whose absence generates an informational notice.
 */
const RECOMMENDED_PATTERNS: Array<{
  pattern: RegExp;
  code: string;
  message: string;
}> = [
  {
    pattern: /env\.events\(\)\.publish/,
    code: "NO_EVENTS",
    message:
      "No event emission detected. Consider publishing events for on-chain observability.",
  },
  {
    pattern: /#\[contracttype\]/,
    code: "NO_CONTRACTTYPE",
    message:
      "No `#[contracttype]` annotation found. Structured data types improve SDK interoperability.",
  },
];

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Validates a rendered (or raw) Soroban contract template source for
 * security issues, missing required patterns, and best-practice recommendations.
 */
export class TemplateValidator {
  /**
   * Validate the given Soroban contract source.
   *
   * @param source - Full Rust source of the contract.
   * @returns A {@link ValidationResult} with validity flag and issue list.
   */
  validate(source: string): ValidationResult {
    const issues: ValidationIssue[] = [];

    // 1. Required patterns
    for (const check of REQUIRED_PATTERNS) {
      if (!check.pattern.test(source)) {
        issues.push({
          code: check.code,
          message: check.message,
          severity: check.severity,
        });
      }
    }

    // 2. Forbidden patterns
    for (const check of FORBIDDEN_PATTERNS) {
      if (check.pattern.test(source)) {
        issues.push({
          code: check.code,
          message: check.message,
          severity: check.severity,
        });
      }
    }

    // 3. Recommended patterns (info only)
    for (const check of RECOMMENDED_PATTERNS) {
      if (!check.pattern.test(source)) {
        issues.push({
          code: check.code,
          message: check.message,
          severity: "info",
        });
      }
    }

    // 4. Placeholder check – the generator should have substituted all tokens
    if (source.includes("{{CONTRACT_NAME}}")) {
      issues.push({
        code: "UNRESOLVED_PLACEHOLDER",
        message:
          "`{{CONTRACT_NAME}}` placeholder was not replaced. Run the generator before validating.",
        severity: "error",
      });
    }

    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      valid: !hasErrors,
      issues,
    };
  }
}
