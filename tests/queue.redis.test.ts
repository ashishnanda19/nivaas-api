import { afterAll, describe, expect, it } from 'vitest'
import { Redis } from 'ioredis'
import { Scheduler } from '../src/lib/queue.js'
import { prisma } from '../src/lib/db.js'

// Runs only when a Redis is available: REDIS_TEST_URL=redis://localhost:6379 npm test
const url = process.env.REDIS_TEST_URL
afterAll(async () => prisma.$disconnect())

describe.skipIf(!url)('scheduler with Redis (BullMQ)', () => {
  it('runs a repeating job through the queue and reports redis in status', async () => {
    const queueName = `nivaas-test-${Date.now()}`
    const s = new Scheduler(url!, queueName)
    let runs = 0
    s.register({ name: 'tick', everyMs: 300, run: async () => { runs++ } })
    await s.start()
    expect(s.mode).toBe('redis')
    expect(await s.status()).toEqual({ mode: 'redis', ok: true })
    const t0 = Date.now()
    while (runs < 2 && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100))
    expect(runs).toBeGreaterThanOrEqual(2)
    await s.stop()
    const r = new Redis(url!)
    const keys = await r.keys(`bull:${queueName}:*`)
    if (keys.length) await r.del(...keys)
    r.disconnect()
  })

  it('reports not ok when redis goes away', async () => {
    const s = new Scheduler(url!, `nivaas-test-${Date.now()}-b`)
    s.register({ name: 'noop', everyMs: 60_000, run: async () => {} })
    await s.start()
    ;(s as unknown as { redis: Redis }).redis.disconnect()
    expect((await s.status()).ok).toBe(false)
    await s.stop()
  })
})
