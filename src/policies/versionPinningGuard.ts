import { Request, Response, NextFunction } from 'express';
import { PolicyVersioningService } from './versioning.service';
import { logger } from '../utils/logger';

export function enforcePinnedPolicy(policyId: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Extract pinned version from headers or request body metadata
    const pinnedVersion = (req.headers['x-policy-version'] as string) || req.body?.policyVersion;

    try {
      const evaluation = PolicyVersioningService.evaluatePolicy(
        policyId,
        {
          gasLimit: req.body?.gasLimit || 0,
          opcodes: req.body?.opcodes,
        },
        pinnedVersion
      );

      // Attach resolved policy version to response headers for audit traceability
      res.setHeader('X-Policy-Version-Applied', evaluation.versionUsed);

      if (!evaluation.compliant) {
        logger.warn({ policyId, versionUsed: evaluation.versionUsed, reason: evaluation.reason }, 'Pinned policy evaluation failed');
        return res.status(403).json({
          error: 'Policy compliance violation',
          policyId,
          version: evaluation.versionUsed,
          message: evaluation.reason,
        });
      }

      next();
    } catch (error: any) {
      logger.error({ err: error, policyId, pinnedVersion }, 'Error evaluating pinned policy');
      return res.status(400).json({ error: error.message });
    }
  };
}