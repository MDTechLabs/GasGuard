/**
 * CSV serialization for findings export (#1039).
 */

import { Finding } from './finding.types';

export const FINDING_CSV_COLUMNS: Array<{
  header: string;
  value: (f: Finding) => unknown;
}> = [
  { header: 'id', value: (f) => f.id },
  { header: 'organizationId', value: (f) => f.organizationId },
  { header: 'repositoryId', value: (f) => f.repositoryId },
  { header: 'analysisJobId', value: (f) => f.analysisJobId },
  { header: 'title', value: (f) => f.title },
  { header: 'description', value: (f) => f.description },
  { header: 'severity', value: (f) => f.severity },
  { header: 'status', value: (f) => f.status },
  { header: 'ruleId', value: (f) => f.ruleId },
  { header: 'filePath', value: (f) => f.filePath },
  { header: 'line', value: (f) => f.line },
  { header: 'assignedTo', value: (f) => f.assignedTo },
  { header: 'createdAt', value: (f) => f.createdAt },
  { header: 'updatedAt', value: (f) => f.updatedAt },
];

/**
 * Escape a single CSV cell (RFC 4180). Cells starting with a formula
 * trigger character are prefixed with a quote to prevent CSV injection
 * when opened in spreadsheet software.
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  let s = String(raw);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function findingsToCsv(findings: Finding[]): string {
  const lines = [FINDING_CSV_COLUMNS.map((c) => c.header).join(',')];
  for (const f of findings) {
    lines.push(FINDING_CSV_COLUMNS.map((c) => escapeCsvCell(c.value(f))).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
