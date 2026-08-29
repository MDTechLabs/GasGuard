export type FixApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface FixAuditEntry {
  timestamp: string;
  actor: string;
  decision: 'created' | 'approved' | 'rejected';
  reason?: string;
}

export interface PendingFix {
  id: string;
  filePath: string;
  originalSource: string;
  status: FixApprovalStatus;
  fix: {
    startLine: number;
    endLine: number;
    replacement: string[];
    description: string;
  };
  reviewer?: string;
  decisionReason?: string;
  auditTrail: FixAuditEntry[];
}

export function createPendingFix(
  filePath: string,
  originalSource: string,
  fix: PendingFix['fix'],
): PendingFix {
  const timestamp = new Date().toISOString();
  return {
    id: `fix-${timestamp}-${Math.random().toString(16).slice(2, 8)}`,
    filePath,
    originalSource,
    status: 'pending',
    fix,
    auditTrail: [
      {
        timestamp,
        actor: 'system',
        decision: 'created',
      },
    ],
  };
}

export function approveFix(
  fix: PendingFix,
  reviewer: string,
  reason = 'Approved by reviewer',
): PendingFix {
  return {
    ...fix,
    status: 'approved',
    reviewer,
    decisionReason: reason,
    auditTrail: [
      ...fix.auditTrail,
      {
        timestamp: new Date().toISOString(),
        actor: reviewer,
        decision: 'approved',
        reason,
      },
    ],
  };
}

export function rejectFix(
  fix: PendingFix,
  reviewer: string,
  reason = 'Rejected by reviewer',
): PendingFix {
  return {
    ...fix,
    status: 'rejected',
    reviewer,
    decisionReason: reason,
    auditTrail: [
      ...fix.auditTrail,
      {
        timestamp: new Date().toISOString(),
        actor: reviewer,
        decision: 'rejected',
        reason,
      },
    ],
  };
}

export function applyOnlyApprovedFixes(
  source: string,
  fixes: PendingFix[],
): { source: string; applied: PendingFix[]; skipped: PendingFix[] } {
  const approved = fixes.filter((fix) => fix.status === 'approved');
  const skipped = fixes.filter((fix) => fix.status !== 'approved');

  const lines = source.split('\n');
  const applied: PendingFix[] = [];
  const sorted = [...approved].sort((a, b) => b.fix.startLine - a.fix.startLine);

  for (const fix of sorted) {
    const start = Math.max(0, fix.fix.startLine - 1);
    const deleteCount = fix.fix.endLine - fix.fix.startLine + 1;
    lines.splice(start, deleteCount, ...fix.fix.replacement);
    applied.push(fix);
  }

  return {
    source: lines.join('\n'),
    applied,
    skipped,
  };
}
