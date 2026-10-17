/**
 * Framework detection with confidence metadata (#1170).
 *
 * Rule selection depends on knowing which framework a repository uses, but
 * detection is inherently heuristic. Instead of a bare string, detection
 * returns a confidence in [0, 1] and the evidence behind it, so callers can
 * ignore weak matches (or surface them for review) rather than acting on a
 * coin flip.
 *
 * Confidence is the sum of weighted evidence, capped at 1. Every check is a
 * pure function of the manifest and the file list.
 */

export type FrameworkId =
  | "next"
  | "nestjs"
  | "react"
  | "vue"
  | "svelte"
  | "express"
  | "foundry"
  | "hardhat"
  | "cargo"
  | "unknown";

export interface FrameworkSignal {
  framework: FrameworkId;
  /** Confidence in [0, 1]. */
  confidence: number;
  evidence: string[];
}

export interface FrameworkDetectionInput {
  /** Dependency names from package.json (dependencies + devDependencies). */
  dependencies?: string[];
  /** Repository-relative file paths. */
  files?: string[];
}

interface FrameworkRule {
  framework: FrameworkId;
  /** Dependency name -> weight when present. */
  dependencies: Record<string, number>;
  /** File path predicate -> weight when matched. */
  files: Array<{ test: (path: string) => boolean; weight: number; label: string }>;
}

const FRAMEWORK_RULES: FrameworkRule[] = [
  {
    framework: "next",
    dependencies: { next: 0.8 },
    files: [
      { test: (p) => /(^|\/)next\.config\.(js|mjs|ts)$/.test(p), weight: 0.3, label: "next.config" },
      { test: (p) => /(^|\/)app\/.*page\.(tsx|jsx|ts|js)$/.test(p), weight: 0.2, label: "app router page" },
    ],
  },
  {
    framework: "nestjs",
    dependencies: { "@nestjs/core": 0.8 },
    files: [{ test: (p) => /(^|\/)nest-cli\.json$/.test(p), weight: 0.2, label: "nest-cli.json" }],
  },
  {
    framework: "react",
    dependencies: { react: 0.7 },
    files: [{ test: (p) => /\.(tsx|jsx)$/.test(p), weight: 0.2, label: "JSX source" }],
  },
  {
    framework: "vue",
    dependencies: { vue: 0.8 },
    files: [{ test: (p) => p.endsWith(".vue"), weight: 0.2, label: "single-file component" }],
  },
  {
    framework: "svelte",
    dependencies: { svelte: 0.8 },
    files: [{ test: (p) => p.endsWith(".svelte"), weight: 0.2, label: "svelte component" }],
  },
  {
    framework: "express",
    dependencies: { express: 0.7 },
    files: [{ test: (p) => /(^|\/)routes?\//.test(p), weight: 0.1, label: "routes directory" }],
  },
  {
    framework: "foundry",
    dependencies: {},
    files: [
      { test: (p) => /(^|\/)foundry\.toml$/.test(p), weight: 1, label: "foundry.toml" },
      { test: (p) => /(^|\/)test\/.*\.t\.sol$/.test(p), weight: 0.2, label: "foundry test" },
    ],
  },
  {
    framework: "hardhat",
    dependencies: { hardhat: 0.8 },
    files: [{ test: (p) => /(^|\/)hardhat\.config\.(ts|js)$/.test(p), weight: 0.2, label: "hardhat.config" }],
  },
  {
    framework: "cargo",
    dependencies: {},
    files: [{ test: (p) => /(^|\/)Cargo\.toml$/.test(p), weight: 1, label: "Cargo.toml" }],
  },
];

export const MIN_FRAMEWORK_CONFIDENCE = 0.2;

/**
 * Detect the frameworks in use, strongest first.
 *
 * Ties are broken by framework id so the output is deterministic.
 */
export function detectFrameworks(input: FrameworkDetectionInput): FrameworkSignal[] {
  const dependencies = new Set(
    (input.dependencies ?? []).map((dependency) => dependency.trim().toLowerCase()),
  );
  const files = input.files ?? [];

  const signals: FrameworkSignal[] = [];

  for (const rule of FRAMEWORK_RULES) {
    const evidence: string[] = [];
    let confidence = 0;

    for (const [dependency, weight] of Object.entries(rule.dependencies)) {
      if (dependencies.has(dependency.toLowerCase())) {
        confidence += weight;
        evidence.push(`dependency ${dependency}`);
      }
    }

    for (const fileRule of rule.files) {
      if (files.some((path) => fileRule.test(path))) {
        confidence += fileRule.weight;
        evidence.push(fileRule.label);
      }
    }

    if (confidence >= MIN_FRAMEWORK_CONFIDENCE) {
      signals.push({
        framework: rule.framework,
        confidence: Math.min(1, Number(confidence.toFixed(2))),
        evidence,
      });
    }
  }

  return signals.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      (left.framework < right.framework ? -1 : 1),
  );
}

/** The single best match, or an explicit "unknown" signal. */
export function detectPrimaryFramework(input: FrameworkDetectionInput): FrameworkSignal {
  return (
    detectFrameworks(input)[0] ?? {
      framework: "unknown",
      confidence: 0,
      evidence: [],
    }
  );
}
