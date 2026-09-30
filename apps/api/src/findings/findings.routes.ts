import { Router } from 'express';
import { findingsController } from './findings.controller';

export const findingsRouter = Router();

findingsRouter.get('/', (req, res) => findingsController.list(req, res));
findingsRouter.get('/export', (req, res) => findingsController.exportCsv(req, res));
findingsRouter.post('/reassign', (req, res) => findingsController.reassignBatch(req, res));
findingsRouter.get('/:id', (req, res) => findingsController.getOne(req, res));
findingsRouter.post('/:id/reassign', (req, res) => findingsController.reassignOne(req, res));
findingsRouter.get('/:id/reassignments', (req, res) => findingsController.getHistory(req, res));
