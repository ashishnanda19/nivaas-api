import { buildApp } from './app.js'
import { config } from './lib/config.js'
import { logger } from './lib/logger.js'
import { prisma, startDbKeepWarm } from './lib/db.js'
import { registerJobs } from './jobs/index.js'
import { createMessageProvider } from './modules/auth/messages.js'

const sms = createMessageProvider()
const app = await buildApp({ sms })
registerJobs(app.scheduler, sms)
await app.scheduler.start()
startDbKeepWarm()
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
