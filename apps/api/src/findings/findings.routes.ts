import { Router } from 'express';
import { findingsController } from './findings.controller';

export const findingsRouter = Router();

findingsRouter.get('/', (req, res) => findingsController.list(req, res));
findingsRouter.get('/export', (req, res) => findingsController.exportCsv(req, res));
findingsRouter.post('/expirations/notify', (req, res) => findingsController.notifyExpiring(req, res));
findingsRouter.get('/fingerprints/:fingerprint', (req, res) => findingsController.getFingerprintHistory(req, res));
findingsRouter.post('/reassign', (req, res) => findingsController.reassignBatch(req, res));
findingsRouter.get('/:id', (req, res) => findingsController.getOne(req, res));
findingsRouter.post('/:id/reassign', (req, res) => findingsController.reassignOne(req, res));
findingsRouter.post('/:id/status', (req, res) => findingsController.transitionStatus(req, res));
findingsRouter.get('/:id/status-history', (req, res) => findingsController.getStatusHistory(req, res));
findingsRouter.post('/:id/risk-acceptance', (req, res) => findingsController.acceptRisk(req, res));
findingsRouter.post('/:id/risk-acceptance/revoke', (req, res) => findingsController.revokeRiskAcceptance(req, res));
findingsRouter.get('/:id/risk-acceptance', (req, res) => findingsController.listRiskAcceptances(req, res));
findingsRouter.post('/:id/ownership', (req, res) => findingsController.setOwnership(req, res));
findingsRouter.get('/:id/comments', (req, res) => findingsController.listComments(req, res));
findingsRouter.post('/:id/comments', (req, res) => findingsController.addComment(req, res));
findingsRouter.patch('/:id/comments/:commentId', (req, res) => findingsController.updateComment(req, res));
findingsRouter.delete('/:id/comments/:commentId', (req, res) => findingsController.deleteComment(req, res));
findingsRouter.get('/:id/reassignments', (req, res) => findingsController.getHistory(req, res));
