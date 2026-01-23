import { Request, Response } from 'express';
import { Queue } from 'bullmq';
import { 
  CodebaseSubmissionRequest, 
  AnalysisResponse, 
  AnalysisStatus, 
  AnalysisResult,
  ApiErrorResponse 
} from '../schemas/analysis.schema';
import { AnalysisValidator } from '../validation/analysis.validator';

export class AnalysisController {
  constructor(private queue: Queue) {}

  async submitCodebase(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body as CodebaseSubmissionRequest;
      
      // Determine if this is a large job
      const isLarge = this.isLargeSubmission(payload);
      
      // Add job to queue with appropriate priority and options
      const job = await this.queue.add('analyze-codebase', {
        payload,
        isLarge,
        submittedAt: new Date().toISOString(),
        requestId: req.headers['x-request-id'] as string || 'unknown'
      }, {
        removeOnComplete: false,
        removeOnFail: false,
        attempts: isLarge ? 3 : 5,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        priority: isLarge ? 10 : 100
      });

      const response: AnalysisResponse = {
        jobId: job.id as string,
        status: 'queued',
        submittedAt: new Date().toISOString(),
        estimatedDuration: this.estimateAnalysisDuration(payload),
        statusUrl: `/analysis/${job.id}/status`,
        resultUrl: `/analysis/${job.id}/result`
      };

      res.status(202).json(response);
    } catch (error) {
      console.error('Error submitting codebase:', error);
      this.sendErrorResponse(res, 'SUBMISSION_ERROR', 'Failed to submit codebase for analysis', error);
    }
  }

  async getAnalysisStatus(req: Request, res: Response): Promise<void> {
    try {
      const jobId = req.params.id;
      
      if (!jobId) {
        res.status(400).json({
          error: {
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      const job = await this.queue.getJob(jobId);
      
      if (!job) {
        res.status(404).json({
          error: {
            code: 'JOB_NOT_FOUND',
            message: `Analysis job with ID ${jobId} not found`,
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      const state = await job.getState();
      const progress = job.progress || 0;
      
      const status: AnalysisStatus = {
        jobId,
        status: this.mapJobState(state),
        progress: typeof progress === 'number' ? progress : 0,
        currentStep: job.data?.currentStep,
        startedAt: job.data?.startedAt,
        completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
        error: job.failedReason ? {
          code: 'JOB_FAILED',
          message: job.failedReason,
          timestamp: new Date().toISOString()
        } : undefined
      };

      res.json(status);
    } catch (error) {
      console.error('Error getting analysis status:', error);
      this.sendErrorResponse(res, 'STATUS_ERROR', 'Failed to retrieve analysis status', error);
    }
  }

  async getAnalysisResult(req: Request, res: Response): Promise<void> {
    try {
      const jobId = req.params.id;
      
      if (!jobId) {
        res.status(400).json({
          error: {
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      const job = await this.queue.getJob(jobId);
      
      if (!job) {
        res.status(404).json({
          error: {
            code: 'JOB_NOT_FOUND',
            message: `Analysis job with ID ${jobId} not found`,
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      const state = await job.getState();
      
      if (state !== 'completed') {
        const status: AnalysisStatus = {
          jobId,
          status: this.mapJobState(state),
          progress: typeof job.progress === 'number' ? job.progress : 0,
          startedAt: job.data?.startedAt,
          completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined
        };
        
        res.status(202).json(status);
        return;
      }

      const result = job.returnvalue as AnalysisResult;
      
      if (!result) {
        res.status(500).json({
          error: {
            code: 'NO_RESULT',
            message: 'Analysis completed but no result available',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      res.json({ result });
    } catch (error) {
      console.error('Error getting analysis result:', error);
      this.sendErrorResponse(res, 'RESULT_ERROR', 'Failed to retrieve analysis result', error);
    }
  }

  async cancelAnalysis(req: Request, res: Response): Promise<void> {
    try {
      const jobId = req.params.id;
      
      if (!jobId) {
        res.status(400).json({
          error: {
            code: 'MISSING_JOB_ID',
            message: 'Job ID is required',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      const job = await this.queue.getJob(jobId);
      
      if (!job) {
        res.status(404).json({
          error: {
            code: 'JOB_NOT_FOUND',
            message: `Analysis job with ID ${jobId} not found`,
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      const state = await job.getState();
      
      if (state === 'completed') {
        res.status(400).json({
          error: {
            code: 'ALREADY_COMPLETED',
            message: 'Cannot cancel a completed analysis',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          }
        });
        return;
      }

      await job.remove();
      
      res.json({
        message: 'Analysis cancelled successfully',
        jobId,
        cancelledAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error cancelling analysis:', error);
      this.sendErrorResponse(res, 'CANCEL_ERROR', 'Failed to cancel analysis', error);
    }
  }

  private isLargeSubmission(payload: CodebaseSubmissionRequest): boolean {
    const totalSize = payload.files.reduce((sum, file) => sum + (file.size || 0), 0);
    const fileCount = payload.files.length;
    
    return totalSize > 5 * 1024 * 1024 || fileCount > 50 || JSON.stringify(payload).length > 200_000;
  }

  private estimateAnalysisDuration(payload: CodebaseSubmissionRequest): number {
    const fileCount = payload.files.length;
    const rustFileCount = payload.files.filter(f => f.language === 'rust').length;
    const totalLines = payload.files.reduce((sum, file) => sum + (file.content.split('\n').length), 0);
    
    // Base time: 30 seconds
    let estimatedSeconds = 30;
    
    // Add time per file
    estimatedSeconds += fileCount * 2;
    
    // Add extra time for Rust files (more complex analysis)
    estimatedSeconds += rustFileCount * 5;
    
    // Add time per 1000 lines of code
    estimatedSeconds += Math.ceil(totalLines / 1000) * 10;
    
    // Cap at 10 minutes
    return Math.min(estimatedSeconds, 600);
  }

  private mapJobState(state: string): 'queued' | 'processing' | 'completed' | 'failed' {
    switch (state) {
      case 'waiting':
      case 'waiting-children':
        return 'queued';
      case 'active':
        return 'processing';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'queued';
    }
  }

  private sendErrorResponse(res: Response, code: string, message: string, error?: any): void {
    const response: ApiErrorResponse = {
      error: {
        code,
        message,
        details: error?.message || error,
        timestamp: new Date().toISOString(),
        requestId: res.locals.requestId || 'unknown'
      }
    };
    
    res.status(500).json(response);
  }
}
