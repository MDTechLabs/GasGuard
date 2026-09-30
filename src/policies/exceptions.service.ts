import { logger } from '../utils/logger';

export type ExceptionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface PolicyExceptionRequest {
  id: string;
  policyId: string;
  requesterWallet: string;
  reason: string;
  status: ExceptionStatus;
  approvedBy?: string;
  expiresAt: number;
  createdAt: number;
}

// In-memory or database-backed store for exceptions
const exceptionStore = new Map<string, PolicyExceptionRequest>();

export class PolicyExceptionService {
  /**
   * Request a policy exception
   */
  static requestException(policyId: string, requesterWallet: string, reason: string, ttlMs: number = 24 * 60 * 60 * 1000): PolicyExceptionRequest {
    const id = `exc_${Math.random().toString(36).substring(2, 11)}`;
    const now = Date.now();

    const exception: PolicyExceptionRequest = {
      id,
      policyId,
      requesterWallet,
      reason,
      status: 'PENDING',
      expiresAt: now + ttlMs,
      createdAt: now,
    };

    exceptionStore.set(id, exception);
    logger.info({ exceptionId: id, policyId, requesterWallet }, 'Policy exception requested');
    return exception;
  }

  /**
   * Approve or reject an exception request
   */
  static reviewException(id: string, approverWallet: string, decision: 'APPROVED' | 'REJECTED'): PolicyExceptionRequest {
    const exception = exceptionStore.get(id);
    if (!exception) {
      throw new Error(`Policy exception request ${id} not found`);
    }

    if (exception.status !== 'PENDING') {
      throw new Error(`Exception request is already ${exception.status}`);
    }

    exception.status = decision;
    exception.approvedBy = approverWallet;
    exceptionStore.set(id, exception);

    logger.info({ exceptionId: id, decision, approverWallet }, 'Policy exception reviewed');
    return exception;
  }

  /**
   * Check if an active, approved exception exists for a policy and requester
   */
  static hasActiveException(policyId: string, requesterWallet: string): boolean {
    const now = Date.now();

    for (const exception of exceptionStore.values()) {
      if (
        exception.policyId === policyId &&
        exception.requesterWallet === requesterWallet &&
        exception.status === 'APPROVED' &&
        exception.expiresAt > now
      ) {
        return true;
      }
    }
    return false;
  }
}