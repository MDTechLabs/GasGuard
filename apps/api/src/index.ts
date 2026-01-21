import { createServer } from './server.js'
import { initQueue } from './queue/index.js'

const port = Number(process.env.PORT || 3000)
const redisUrl = process.env.REDIS_URL || ''
const queueName = process.env.SCAN_QUEUE_NAME || 'gasguard:scan'

const { queue, worker, events } = initQueue({ redisUrl, queueName })
const app = createServer(queue)

app.listen(port, () => {})

process.on('SIGINT', async () => {
  await worker?.close()
  await events?.close()
  process.exit(0)
})