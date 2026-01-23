import express, { Request, Response } from 'express'
import { Queue } from 'bullmq'
import { createAnalysisRoutes } from './routes/analysis.routes'
import { errorHandler, notFoundHandler, requestIdHandler } from './middleware/error.middleware'

export function createServer(queue: Queue) {
  const app = express()
  
  // Middleware
  app.use(express.json({ limit: '50mb' }))
  app.use(requestIdHandler)
  
  // CORS headers
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Request-ID')
    res.header('Access-Control-Max-Age', '86400')
    
    if (req.method === 'OPTIONS') {
      res.status(200).end()
      return
    }
    next()
  })

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      requestId: req.headers['x-request-id']
    })
  })

  // API documentation endpoint
  app.get('/docs', (req: Request, res: Response) => {
    res.json({
      title: 'GasGuard Analysis API',
      version: '1.0.0',
      description: 'API for submitting codebases for security and performance analysis',
      endpoints: {
        'POST /analysis': 'Submit codebase for analysis',
        'GET /analysis/:id/status': 'Get analysis status',
        'GET /analysis/:id/result': 'Get analysis results',
        'DELETE /analysis/:id': 'Cancel analysis',
        'GET /health': 'Health check'
      },
      documentation: 'https://docs.gasguard.dev'
    })
  })

  // Legacy scan endpoints (for backward compatibility)
  app.post('/scan', async (req: Request, res: Response) => {
    const payload = req.body || {}
    const isLarge = JSON.stringify(payload).length > 200_000 || payload?.large === true
    const job = await queue.add('scan', { payload, isLarge }, { removeOnComplete: true, removeOnFail: true })
    res.status(202).json({ jobId: job.id, statusUrl: `/scan/${job.id}/status`, resultUrl: `/scan/${job.id}/result` })
  })

  app.get('/scan/:id/status', async (req: Request, res: Response) => {
    const id = req.params.id
    const job = await queue.getJob(id)
    if (!job) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const state = await job.getState()
    const progress = job.progress || 0
    res.json({ state, progress })
  })

  app.get('/scan/:id/result', async (req: Request, res: Response) => {
    const id = req.params.id
    const job = await queue.getJob(id)
    if (!job) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    const state = await job.getState()
    if (state !== 'completed') {
      res.status(202).json({ state })
      return
    }
    const result = job.returnvalue
    res.json({ result })
  })

  // New analysis endpoints
  app.use('/', createAnalysisRoutes(queue))

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}