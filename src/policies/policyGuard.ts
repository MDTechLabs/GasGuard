import { Request, Response, NextFunction } from 'express';
import { PolicyExceptionService } from './exceptions.service';
import { logger } from '../utils/logger';

export function enforcePolicy(policyId: string) {
  return (req: Request & { user?: { publicKey?: string } }, res: Response, next: NextFunction) => {
    const userWallet = req.user?.publicKey || req.ip;
    const violatesPolicy = checkTransactionViolation(req.body); // Core policy evaluation

    if (!violatesPolicy) {
      return next();
    }

    // Check if an approved exception exists
    const hasException = PolicyExceptionService.hasActiveException(policyId, userWallet);

    if (hasException) {
      logger.info({ policyId, userWallet }, 'Policy violation bypassed via approved exception');
      res.setHeader('X-Policy-Exception-Applied', 'true');
      return next();
    }

    logger.warn({ policyId, userWallet }, 'Policy violation blocked');
    return res.status(403).json({
      error: 'Policy violation detected',
      policyId,
      message: 'Transaction violates active gas/security policy. Request an exception if needed.',
    });
  };
}

function checkTransactionViolation(body: any): boolean {
  // Mock policy rule check (e.g., gas limit exceeding threshold or prohibited opcode)
  return body?.gasLimit > 5000000;
}