import express, { Request, Response } from 'express'
import { Queue } from 'bullmq'

export function createServer(queue: Queue) {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

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

  return app
}