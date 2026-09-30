/**
 * Stable finding fingerprints for tracking the same issue across analysis runs (#1031).
 *
 * The fingerprint deliberately excludes the analysis job id, line number and
 * timestamps so that it survives re-runs and unrelated edits that shift lines.
 */

import { createHash } from 'crypto';

export interface FingerprintInput {
  organizationId: string;
  repositoryId: string;
  ruleId: string;
  title: string;
  filePath?: string;
}

function normalize(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\\/g, '/').replace(/\s+/g, ' ');
}

export function computeFindingFingerprint(input: FingerprintInput): string {
  const material = [
    normalize(input.organizationId),
    normalize(input.repositoryId),
    normalize(input.ruleId),
    normalize(input.filePath),
    normalize(input.title),
  ].join('\u0000');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
