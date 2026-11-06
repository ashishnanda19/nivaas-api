import { buildApp } from './app.js'
import { config } from './lib/config.js'
import { logger } from './lib/logger.js'
import { prisma } from './lib/db.js'
import { registerJobs } from './jobs/index.js'

const app = await buildApp()
registerJobs(app.scheduler)
await app.scheduler.start()
await app.listen({ port: config.PORT, host: '0.0.0.0' })
logger.info(`Nivaas API listening on ${config.PORT}`)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close()
    await app.scheduler.stop()
    await prisma.$disconnect()
    process.exit(0)
  })
}
