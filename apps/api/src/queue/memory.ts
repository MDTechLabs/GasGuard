import { Queue } from 'bullmq'

type JobRecord = {
  id: string
  state: 'waiting' | 'active' | 'completed' | 'failed'
  progress: number
  returnvalue?: unknown
}

export function createInMemoryQueue(name: string) {
  const jobs = new Map<string, JobRecord>()
  const q = new Queue(name, { connection: { host: 'localhost', port: 6379 } as any })

  const queue = {
    add: async (_name: string, data: any) => {
      const id = Math.random().toString(36).slice(2)
      jobs.set(id, { id, state: 'waiting', progress: 0 })
      setTimeout(async () => {
        const j = jobs.get(id)
        if (!j) return
        j.state = 'active'
        j.progress = 10
        try {
          const result = await simulateScan(data.payload, p => {
            const jj = jobs.get(id)
            if (jj) jj.progress = p
          })
          j.returnvalue = result
          j.state = 'completed'
          j.progress = 100
        } catch {
          j.state = 'failed'
        }
      }, 0)
      return { id }
    },
    getJob: async (id: string) => {
      const j = jobs.get(id)
      if (!j) return null
      return {
        id: j.id,
        progress: j.progress,
        returnvalue: j.returnvalue,
        getState: async () => j.state
      } as any
    }
  } as unknown as Queue

  const worker = { close: async () => {} } as any
  const events = { close: async () => {} } as any
  return { queue, worker, events }
}

async function simulateScan(input: any, onProgress: (p: number) => void) {
  onProgress(25)
  await sleep(400)
  onProgress(50)
  await sleep(400)
  onProgress(75)
  await sleep(400)
  onProgress(100)
  return { summary: 'ok', issues: [], inputSize: JSON.stringify(input || {}).length }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}