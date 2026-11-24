import type { Finding } from "./analyzer-interface";
import { computeFindingFingerprint } from "./finding-fingerprint";
import { resolveProvenance, SourceMapEntry } from "./finding-provenance";

export interface FindingMetadataOptions {
  /** Source maps keyed by reported file path. */
  sourceMaps?: Record<string, SourceMapEntry[]>;
  /** Include the file path in fingerprints. Default false. */
  includePathInFingerprint?: boolean;
}

/**
 * Adds `metadata.fingerprint` and `metadata.provenance` to each finding, in place.
 * Existing metadata keys are kept. A finding whose file content is not in `files` gets
 * provenance but no fingerprint, because the flagged code cannot be read.
 */
export function annotateFindings(
  findings: Finding[],
  files: Map<string, string>,
  options: FindingMetadataOptions = {},
): void {
  for (const finding of findings) {
    const file = finding.location.file;
    const code = files.get(file) ?? files.get(file.replace(/\\/g, "/"));
    const sourceMap = options.sourceMaps?.[file];
    const provenance = resolveProvenance(file, code ?? "", finding.location.startLine, {
      sourceMap,
    });
    const next: Record<string, unknown> = { ...(finding.metadata ?? {}), provenance };
    if (code !== undefined) {
      next.fingerprint = computeFindingFingerprint(
        {
          ruleId: finding.ruleId,
          location: {
            file,
            startLine: finding.location.startLine,
            endLine: finding.location.endLine,
          },
        },
        code,
        { includePath: options.includePathInFingerprint === true },
      );
    }
    finding.metadata = next;
  }
}
