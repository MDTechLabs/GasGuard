import { createHash } from "crypto";

/**
 * Stable finding location mapping.
 *
 * A finding's line number goes stale as soon as code above it changes. Instead
 * of trusting the line, we store a content *anchor*: hashes of the flagged
 * lines plus a few neighbouring non-blank lines. Given a later revision of the
 * file, `mapLocation` finds where that code moved to, or says it can't.
 *
 * Guarantees:
 *  - Pure, no I/O, no clock, tenant-agnostic. Never throws on bad input.
 *  - Deterministic: same anchor + same content + same options always give the
 *    same answer, including on ties (closest to the old line, then lowest line).
 *  - Honest: weak matches are reported as `ambiguous` or `lost`, never guessed
 *    at with high confidence.
 */

export const LOCATION_ANCHOR_VERSION = 1;
export const DEFAULT_CONTEXT_LINES = 3;
export const DEFAULT_MIN_CONFIDENCE = 0.65;
export const DEFAULT_MAX_CANDIDATES = 500;
/** Confidence reported when only the surroundings of an edited line matched. */
const MODIFIED_CONFIDENCE = 0.65;
/** How far past blank lines we look for a non-blank neighbour. */
const MAX_BLANK_SCAN = 50;
/** Hard limit on anchored span so a bad finding can't make us hash a whole file. */
export const MAX_ANCHOR_SPAN_LINES = 200;

export interface SourceSpan {
  /** 1-based inclusive. */
  startLine: number;
  endLine?: number;
}

export interface LocationAnchor {
  version: number;
  /** Line numbers where the anchor was taken (the "last known" location). */
  startLine: number;
  endLine: number;
  /** Hash of the normalized first flagged line. Empty when that line is blank. */
  lineHash: string;
  /** Hash of all normalized lines in the span. */
  spanHash: string;
  /** Hashes of the nearest non-blank lines above, nearest first. */
  before: string[];
  /** Hashes of the nearest non-blank lines below, nearest first. */
  after: string[];
}

export type LocationStatus =
  /** Same lines, same place. */
  | "exact"
  /** Same code, found at a different line. */
  | "moved"
  /** The flagged line was edited, but its surroundings match exactly. */
  | "modified"
  /** Several equally good matches; the closest one was chosen. */
  | "ambiguous"
  /** No acceptable match. Line numbers are the last known ones. */
  | "lost";

export interface LocationMapping {
  status: LocationStatus;
  startLine: number;
  endLine: number;
  /** 0..1. 0 when lost. */
  confidence: number;
  /** startLine - anchor.startLine. */
  delta: number;
}

export interface LocationMapOptions {
  /** Neighbouring non-blank lines hashed on each side. Default 3. */
  contextLines?: number;
  /** Minimum confidence to accept a match. Default 0.65. */
  minConfidence?: number;
  /** Max candidate positions scored per lookup. Default 500. */
  maxCandidates?: number;
}

/** Pre-split, pre-hashed file; build once and reuse for many anchors. */
export interface FileLineIndex {
  lineCount: number;
  hashes: string[];
  positions: Map<string, number[]>;
}

function hashLine(text: string): string {
  const norm = text.trim().replace(/\s+/g, " ");
  if (norm === "") return "";
  return createHash("sha256").update(norm).digest("hex").slice(0, 12);
}

function hashSpan(hashes: string[]): string {
  return createHash("sha256").update(hashes.join(",")).digest("hex").slice(0, 16);
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r\n|\r|\n/);
  // A trailing newline does not start a new line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function buildFileLineIndex(content: string): FileLineIndex {
  const hashes = splitLines(typeof content === "string" ? content : "").map(hashLine);
  const positions = new Map<string, number[]>();
  hashes.forEach((h, i) => {
    if (h === "") return;
    const list = positions.get(h);
    if (list) list.push(i);
    else positions.set(h, [i]);
  });
  return { lineCount: hashes.length, hashes, positions };
}

function neighbours(hashes: string[], from: number, step: 1 | -1, count: number): string[] {
  const out: string[] = [];
  let scanned = 0;
  for (let i = from + step; i >= 0 && i < hashes.length && out.length < count; i += step) {
    if (hashes[i] === "") {
      if (++scanned > MAX_BLANK_SCAN) break;
      continue;
    }
    out.push(hashes[i]);
  }
  return out;
}

function toInt(n: unknown): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/**
 * Captures an anchor for `span` in `content`. Returns undefined when the span
 * doesn't lie inside the file (so callers store no anchor rather than a bogus one).
 */
export function createLocationAnchor(
  content: string,
  span: SourceSpan,
  options: LocationMapOptions = {},
): LocationAnchor | undefined {
  const startLine = toInt(span?.startLine);
  if (startLine === undefined || typeof content !== "string") return undefined;
  let endLine = toInt(span.endLine) ?? startLine;
  if (endLine < startLine) endLine = startLine;

  const index = buildFileLineIndex(content);
  if (startLine > index.lineCount) return undefined;
  endLine = Math.min(endLine, index.lineCount, startLine + MAX_ANCHOR_SPAN_LINES - 1);

  const n = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const s = startLine - 1;
  const e = endLine - 1;
  return {
    version: LOCATION_ANCHOR_VERSION,
    startLine,
    endLine,
    lineHash: index.hashes[s],
    spanHash: hashSpan(index.hashes.slice(s, e + 1)),
    before: neighbours(index.hashes, s, -1, n),
    after: neighbours(index.hashes, e, 1, n),
  };
}

export function isLocationAnchor(value: unknown): value is LocationAnchor {
  const a = value as LocationAnchor | null;
  return (
    a !== null &&
    typeof a === "object" &&
    a.version === LOCATION_ANCHOR_VERSION &&
    toInt(a.startLine) !== undefined &&
    toInt(a.endLine) !== undefined &&
    a.endLine >= a.startLine &&
    typeof a.lineHash === "string" &&
    typeof a.spanHash === "string" &&
    Array.isArray(a.before) &&
    Array.isArray(a.after) &&
    a.before.every((h) => typeof h === "string") &&
    a.after.every((h) => typeof h === "string")
  );
}

function sideScore(expected: string[], actual: string[]): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0.5;
  // Only the unbroken run starting at the flagged line counts: a mismatch
  // right next to the code means the neighbourhood is not the same place.
  let run = 0;
  while (run < expected.length && expected[run] === actual[run]) run++;
  return run / expected.length;
}

function lost(anchor: LocationAnchor): LocationMapping {
  return { status: "lost", startLine: anchor.startLine, endLine: anchor.endLine, confidence: 0, delta: 0 };
}

interface Candidate {
  line: number; // 1-based
  confidence: number;
  spanMatches: boolean;
}

/**
 * Finds where `anchor` lives in `target` (file content or a prebuilt index).
 *
 * Confidence = 0.2 (line text matches) + 0.3 (whole span matches) +
 * 0.5 * context agreement (average, over the lines above and below, of how
 * much of the nearest-first neighbour run still matches). Context must
 * therefore agree at least ~30% for a match to be accepted at the default
 * threshold, so an edited line is never silently pinned to an identical-looking
 * line elsewhere in the file.
 */
export function mapLocation(
  anchor: LocationAnchor,
  target: string | FileLineIndex,
  options: LocationMapOptions = {},
): LocationMapping {
  if (!isLocationAnchor(anchor)) {
    return { status: "lost", startLine: 1, endLine: 1, confidence: 0, delta: 0 };
  }
  const index = typeof target === "string" ? buildFileLineIndex(target) : target;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const n = Math.max(anchor.before.length, anchor.after.length, options.contextLines ?? 0);
  const span = anchor.endLine - anchor.startLine;

  const clampSpan = (start: number) => ({
    startLine: start,
    endLine: Math.min(start + span, Math.max(index.lineCount, start)),
  });

  const score = (i: number): Candidate => {
    const spanHashes = index.hashes.slice(i, i + span + 1);
    const spanMatches = spanHashes.length === span + 1 && hashSpan(spanHashes) === anchor.spanHash;
    const before = sideScore(anchor.before, neighbours(index.hashes, i, -1, n));
    const after = sideScore(anchor.after, neighbours(index.hashes, i + span, 1, n));
    return {
      line: i + 1,
      spanMatches,
      confidence: 0.2 + (spanMatches ? 0.3 : 0) + 0.25 * before + 0.25 * after,
    };
  };

  const better = (a: Candidate, b: Candidate): number =>
    b.confidence - a.confidence ||
    Math.abs(a.line - anchor.startLine) - Math.abs(b.line - anchor.startLine) ||
    a.line - b.line;

  // Blank anchor line: only the original position can be trusted.
  if (anchor.lineHash === "") {
    const same = index.hashes.slice(anchor.startLine - 1, anchor.endLine);
    if (same.length === span + 1 && hashSpan(same) === anchor.spanHash) {
      return { status: "exact", ...clampSpan(anchor.startLine), confidence: 1, delta: 0 };
    }
    return lost(anchor);
  }

  const positions = index.positions.get(anchor.lineHash) ?? [];
  if (positions.length > 0) {
    const candidates = positions.slice(0, maxCandidates).map(score).sort(better);
    const best = candidates[0];
    if (best.confidence >= minConfidence) {
      const runnerUp = candidates[1];
      const sameLine = best.line === anchor.startLine;
      let status: LocationStatus;
      if (sameLine && best.spanMatches) status = "exact";
      else if (
        runnerUp &&
        runnerUp.confidence === best.confidence &&
        runnerUp.line !== best.line
      ) status = "ambiguous";
      else status = sameLine ? "modified" : "moved";
      return {
        status,
        ...clampSpan(best.line),
        confidence: Number(best.confidence.toFixed(3)),
        delta: best.line - anchor.startLine,
      };
    }
  }

  // The flagged line itself changed. Accept only if both neighbourhoods agree
  // perfectly, there is something to compare, and exactly one place matches.
  if (anchor.before.length > 0 && anchor.after.length > 0) {
    const matches: number[] = [];
    const first = anchor.before[0];
    for (let i = 0; i < index.lineCount && matches.length < 2; i++) {
      if (index.hashes[i] === "" || index.hashes[i] === anchor.lineHash) continue;
      // `i` is the candidate start line; its nearest non-blank neighbours must match.
      const b = neighbours(index.hashes, i, -1, anchor.before.length);
      if (b[0] !== first) continue;
      const a = neighbours(index.hashes, i + span, 1, anchor.after.length);
      if (sideScore(anchor.before, b) === 1 && sideScore(anchor.after, a) === 1) matches.push(i + 1);
    }
    if (matches.length === 1 && MODIFIED_CONFIDENCE >= minConfidence) {
      return {
        status: "modified",
        ...clampSpan(matches[0]),
        confidence: MODIFIED_CONFIDENCE,
        delta: matches[0] - anchor.startLine,
      };
    }
  }

  return lost(anchor);
}
