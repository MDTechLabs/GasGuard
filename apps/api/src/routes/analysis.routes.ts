import { Router } from 'express';
import { AnalysisController } from '../controllers/analysis.controller';
import { AnalysisValidator } from '../validation/analysis.validator';

export function createAnalysisRoutes(queue: any): Router {
  const router = Router();
  const controller = new AnalysisController(queue);

  // Submit codebase for analysis
  router.post('/analysis', 
    AnalysisValidator.validateSubmission,
    (req, res) => controller.submitCodebase(req, res)
  );

  // Get analysis status
  router.get('/analysis/:id/status', 
    (req, res) => controller.getAnalysisStatus(req, res)
  );

  // Get analysis result
  router.get('/analysis/:id/result', 
    (req, res) => controller.getAnalysisResult(req, res)
  );

  // Cancel analysis
  router.delete('/analysis/:id', 
    (req, res) => controller.cancelAnalysis(req, res)
  );

  return router;
}
