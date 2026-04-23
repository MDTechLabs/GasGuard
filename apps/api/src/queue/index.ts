import { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq'
import { createClient } from 'ioredis'
import { performScan } from '../scan.js'
import { createInMemoryQueue } from './memory.js'
import { cacheService } from '../common/cache/index.js'

type InitOptions = { redisUrl: string; queueName: string }

export function initQueue({ redisUrl, queueName }: InitOptions) {
  if (!redisUrl) {
    const { queue, worker, events } = createInMemoryQueue(queueName)
    return { queue, worker, events }
  }
  const connection = new createClient(redisUrl)
  const queue = new Queue(queueName, { connection })
  const events = new QueueEvents(queueName, { connection })
  const worker = new Worker(
    queueName,
    async job => {
      const payload = job.data.payload
      await job.updateProgress(10)
      const result = await performScan(payload, p => job.updateProgress(p))
      
      // Cache the result if it has project info
      if (payload?.project?.repositoryUrl && payload?.project?.commitHash) {
        const cacheKey = cacheService.generateKey(payload.project.repositoryUrl, payload.project.commitHash);
        await cacheService.set(cacheKey, { ...result, jobId: job.id });
      }

      return result
    },
    { connection }
  )
  return { queue, worker, events }
}

export const defaultJobOptions: JobsOptions = { removeOnComplete: true, removeOnFail: true }