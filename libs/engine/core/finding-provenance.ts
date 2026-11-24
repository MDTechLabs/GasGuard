/**
 * Provenance for findings: where a reported line really comes from.
 *
 * Analysis often runs on generated or flattened Solidity (build artifacts, typechain output,
 * `hardhat flatten` / `truffle-flattener` bundles). A finding on line 812 of a flattened file
 * is not useful until it says which original file and line that is.
 *
 * Three sources of evidence are used, in this order, and nothing is guessed:
 *  1. `source-map`: an explicit entry from a source map the caller supplied for this exact
 *     generated line.
 *  2. `flatten-marker`: a `// File: path` header that flatteners write before each source
 *     file. The original line is counted from that header.
 *  3. `none`: no evidence. The original location is the reported one. Build-output paths are
 *     still marked `generated`.
 *
 * Pure: no I/O. Malformed input yields the `none` result rather than throwing.
 */

export const PROVENANCE_VERSION = 1;

export type ProvenanceMapping = "source-map" | "flatten-marker" | "none";

export interface SourceMapEntry {
  /** 1-based line in the reported (generated) file. */
  generatedLine: number;
  sourceFile: string;
  /** 1-based line in `sourceFile`. */
  sourceLine: number;
}

export interface FindingProvenance {
  version: number;
  reportedFile: string;
  reportedLine: number;
  /** `generated` when the reported file is build output or a flattened bundle. */
  origin: "original" | "generated";
  originalFile: string;
  originalLine: number;
  mapping: ProvenanceMapping;
}

export interface ProvenanceOptions {
  /** Source-map entries for the reported file. Only exact generated-line matches are used. */
  sourceMap?: SourceMapEntry[];
}

/** Paths that usually hold build output rather than hand-written sources. */
const GENERATED_PATH =
  /(^|\/)(artifacts|typechain|typechain-types|generated|build|cache|out)\/|\.(generated|g)\.sol$/i;
const FILE_MARKER = /^\s*\/\/\s*File:\s*(.+?)\s*$/;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isUsableEntry(entry: unknown): entry is SourceMapEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const candidate = entry as SourceMapEntry;
  return (
    isPositiveInteger(candidate.generatedLine) &&
    isPositiveInteger(candidate.sourceLine) &&
    typeof candidate.sourceFile === "string" &&
    candidate.sourceFile.trim() !== ""
  );
}

/** The 1-based marker line of the last `// File:` header before `line`, or null. */
function lastFlattenMarker(code: string, line: number): { file: string; markerLine: number } | null {
  const lines = code.split(/\r?\n/);
  let found: { file: string; markerLine: number } | null = null;
  const limit = Math.min(line - 1, lines.length);
  for (let i = 0; i < limit; i++) {
    const match = FILE_MARKER.exec(lines[i]);
    if (match) {
      found = { file: match[1].replace(/\\/g, "/"), markerLine: i + 1 };
    }
  }
  return found;
}

export function resolveProvenance(
  reportedFile: string,
  code: string,
  reportedLine: number,
  options: ProvenanceOptions = {},
): FindingProvenance {
  const file = typeof reportedFile === "string" ? reportedFile.replace(/\\/g, "/") : "";
  const buildPath = GENERATED_PATH.test(file);
  const base: FindingProvenance = {
    version: PROVENANCE_VERSION,
    reportedFile: file,
    reportedLine,
    origin: buildPath ? "generated" : "original",
    originalFile: file,
    originalLine: reportedLine,
    mapping: "none",
  };
  if (!isPositiveInteger(reportedLine) || typeof code !== "string") {
    return base;
  }

  const mapped = Array.isArray(options.sourceMap)
    ? options.sourceMap.find(
        (entry) => isUsableEntry(entry) && entry.generatedLine === reportedLine,
      )
    : undefined;
  if (mapped) {
    return {
      ...base,
      origin: "generated",
      originalFile: mapped.sourceFile.replace(/\\/g, "/"),
      originalLine: mapped.sourceLine,
      mapping: "source-map",
    };
  }

  const marker = lastFlattenMarker(code, reportedLine);
  if (marker) {
    return {
      ...base,
      origin: "generated",
      originalFile: marker.file,
      // The source begins on the line after its header, which is original line 1.
      originalLine: reportedLine - marker.markerLine,
      mapping: "flatten-marker",
    };
  }

  return base;
}
