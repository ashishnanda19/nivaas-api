import cron, { type ScheduledTask } from 'node-cron'
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from './config.js'
import { prisma } from './db.js'
import { logger } from './logger.js'

export interface JobDef {
  name: string
  everyMs: number
  run: () => Promise<unknown>
}

/**
 * Runs scheduled jobs. With REDIS_URL it uses BullMQ repeatable jobs.
 * Without it, a node-cron tick checks a due time stored in Postgres (JobState) and claims a job with an
 * optimistic update, so a restart catches up on missed runs and two instances never run the same job twice.
 */
export class Scheduler {
  private jobs = new Map<string, JobDef>()
  private task?: ScheduledTask
  private queue?: Queue
  private worker?: Worker
  private redis?: Redis
  mode: 'redis' | 'in-process' | 'stopped' = 'stopped'

  register(...defs: JobDef[]) {
    for (const d of defs) this.jobs.set(d.name, d)
  }

  async start() {
    if (config.REDIS_URL) {
      this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
      this.queue = new Queue('nivaas-jobs', { connection: this.redis })
      for (const j of this.jobs.values())
        await this.queue.upsertJobScheduler(j.name, { every: j.everyMs }, { name: j.name })
      this.worker = new Worker(
        'nivaas-jobs',
        async (job) => {
          await this.jobs.get(job.name)?.run()
        },
        { connection: this.redis },
      )
      this.worker.on('failed', (job, err) => logger.error({ job: job?.name, err: err.message }, 'job failed'))
      this.mode = 'redis'
      return
    }
    this.task = cron.schedule('* * * * *', () => void this.runDue())
    this.mode = 'in-process'
    void this.runDue()
  }

  /** Public so tests and the in-process tick can call it directly. */
  async runDue(now = new Date()) {
    const ran: string[] = []
    for (const j of this.jobs.values()) {
      const st = await prisma.jobState.findUnique({ where: { name: j.name } })
      if (st && now.getTime() - st.lastRunAt.getTime() < j.everyMs) continue
      // Claim: only one instance wins the update for this lastRunAt value.
      if (st) {
        const won = await prisma.jobState.updateMany({ where: { name: j.name, lastRunAt: st.lastRunAt }, data: { lastRunAt: now } })
        if (won.count === 0) continue
      } else {
        try {
          await prisma.jobState.create({ data: { name: j.name, lastRunAt: now } })
        } catch {
          continue
        }
      }
      try {
        await j.run()
        ran.push(j.name)
      } catch (e) {
        logger.error({ job: j.name, err: (e as Error).message }, 'job failed')
        await prisma.jobState.update({ where: { name: j.name }, data: { lastError: (e as Error).message.slice(0, 300) } })
      }
    }
    return ran
  }

  async status(): Promise<{ mode: string; ok: boolean }> {
    if (this.mode === 'redis') {
      try {
        await this.redis!.ping()
        return { mode: 'redis', ok: true }
      } catch {
        return { mode: 'redis', ok: false }
      }
    }
    return { mode: this.mode, ok: this.mode === 'in-process' }
  }

  async stop() {
    this.task?.stop()
    await this.worker?.close()
    await this.queue?.close()
    this.redis?.disconnect()
    this.mode = 'stopped'
  }
}
