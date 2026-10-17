/**
 * Finding location relocation (pure planning half).
 *
 * Decides, per finding, where its flagged code lives in a newer revision of the
 * file. Persistence stays in FindingsService so this module has no state and can
 * be reused by workers and reports.
 */

import {
  buildFileLineIndex,
  createLocationAnchor,
  FileLineIndex,
  isLocationAnchor,
  LocationMapOptions,
  mapLocation,
} from '@engine/core/location-mapper';
import { normalizeFindingPath } from '@engine/core/result-normalizer';
import type { Finding, LocationAnchor, LocationStatus } from './finding.types';

export interface RelocateFindingsInput {
  organizationId: string;
  repositoryId: string;
  /** Current contents by repository-relative path. Paths are normalized. */
  files: Record<string, string> | Map<string, string>;
  /** Paths that no longer exist; anchored findings in them become 'lost'. */
  deletedFiles?: string[];
  options?: LocationMapOptions;
}

export interface RelocateFindingsResult {
  examined: number;
  /** Anchored findings whose line and anchor did not need to change. */
  unchanged: number;
  /** Findings whose line, anchor or status changed to a located state. */
  relocated: number;
  /** Findings that could not be located (or whose file was deleted). */
  lost: number;
  skippedNoAnchor: number;
  /** File content for the finding was not part of this snapshot. */
  skippedFileNotProvided: number;
}

export interface RelocationContext {
  files: Map<string, string>;
  indexes: Map<string, FileLineIndex>;
  deleted: Set<string>;
  options: LocationMapOptions;
}

export type RelocationPlan =
  | { kind: 'skip'; reason: 'no-anchor' | 'file-not-provided' }
  | { kind: 'apply'; changed: boolean; line: number; anchor: LocationAnchor; status: LocationStatus };

export function buildRelocationContext(input: RelocateFindingsInput): RelocationContext {
  const files = new Map<string, string>();
  const entries = input.files instanceof Map ? [...input.files.entries()] : Object.entries(input.files ?? {});
  for (const [path, content] of entries) {
    const norm = normalizeFindingPath(path);
    if (norm !== undefined && typeof content === 'string') files.set(norm, content);
  }
  const deleted = new Set<string>();
  for (const path of input.deletedFiles ?? []) {
    const norm = normalizeFindingPath(path);
    if (norm !== undefined) deleted.add(norm);
  }
  return { files, indexes: new Map(), deleted, options: input.options ?? {} };
}

export function planFindingRelocation(finding: Finding, ctx: RelocationContext): RelocationPlan {
  const anchor = finding.locationAnchor;
  const path = normalizeFindingPath(finding.filePath);
  if (!isLocationAnchor(anchor) || path === undefined) return { kind: 'skip', reason: 'no-anchor' };

  const keep = (status: LocationStatus): RelocationPlan => ({
    kind: 'apply',
    changed: finding.locationStatus !== status,
    line: finding.line ?? anchor.startLine,
    anchor,
    status,
  });

  if (ctx.deleted.has(path)) return keep('lost');

  const content = ctx.files.get(path);
  if (content === undefined) return { kind: 'skip', reason: 'file-not-provided' };

  let index = ctx.indexes.get(path);
  if (!index) {
    index = buildFileLineIndex(content);
    ctx.indexes.set(path, index);
  }

  const mapping = mapLocation(anchor, index, ctx.options);
  // Keep the old anchor when lost so a later revision can still match it.
  if (mapping.status === 'lost') return keep('lost');

  const next =
    createLocationAnchor(content, { startLine: mapping.startLine, endLine: mapping.endLine }, ctx.options) ??
    anchor;
  const line = mapping.startLine;
  const sameAnchor = JSON.stringify(next) === JSON.stringify(anchor);
  // Re-checking an already-relocated finding finds it exactly where we left it.
  // Keep the earlier moved/modified/ambiguous label so reruns are no-ops; only a
  // recovery from 'lost' (or a first run) takes the new status.
  const settled =
    mapping.status === 'exact' &&
    finding.line === line &&
    sameAnchor &&
    finding.locationStatus !== undefined &&
    finding.locationStatus !== 'lost';
  const status = settled ? finding.locationStatus! : mapping.status;
  const changed = finding.line !== line || finding.locationStatus !== status || !sameAnchor;
  return { kind: 'apply', changed, line, anchor: next, status };
}
