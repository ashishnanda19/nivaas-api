import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { ZodError } from 'zod'
import { config } from './lib/config.js'
import { prisma } from './lib/db.js'
import { logger } from './lib/logger.js'
import { AppError } from './lib/errors.js'
import { Scheduler } from './lib/queue.js'
import { authRoutes } from './modules/auth/routes.js'
import { ConsoleMessageProvider, type MessageProvider } from './modules/auth/messages.js'
import { billingRoutes } from './modules/billing/routes.js'
import { paymentRoutes } from './modules/payments/routes.js'
import { flatRoutes } from './modules/flats/routes.js'
import { auditRoutes } from './modules/audit/routes.js'
import { matchingRoutes } from './modules/matching/routes.js'
import { complaintRoutes } from './modules/complaints/routes.js'
import { visitorRoutes } from './modules/visitors/routes.js'
import { amenityRoutes } from './modules/amenities/routes.js'
import { noticeRoutes } from './modules/notices/routes.js'

export interface AppDeps {
  sms?: MessageProvider
  scheduler?: Scheduler
}

export async function buildApp(deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: logger, bodyLimit: 1_000_000, trustProxy: true })
  const scheduler = deps.scheduler ?? new Scheduler()

  await app.register(helmet, { contentSecurityPolicy: config.isProd ? undefined : false })
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
  })
  await app.register(cookie)
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

  // Keep the raw JSON for webhook signature checks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string
    if (!body) return done(null, {})
    try {
      done(null, JSON.parse(body as string))
    } catch {
      done(new AppError(400, 'BAD_JSON', 'Body is not valid JSON'), undefined)
    }
  })

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError)
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } })
    if (err instanceof ZodError)
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request', details: err.issues } })
    if (err.statusCode === 429)
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' } })
    if (err.statusCode && err.statusCode < 500)
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'BAD_REQUEST', message: err.message } })
    req.log.error({ err: err.message, stack: config.isProd ? undefined : err.stack }, 'unhandled error')
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } })
  })
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }))

  app.get('/health', async (_req, reply) => {
    let db = false
    try {
      await prisma.$queryRaw`SELECT 1`
      db = true
    } catch {
      /* reported below */
    }
    const queue = await scheduler.status()
    const { aiMode } = await import('./modules/ai/index.js')
    const ok = db && (queue.ok || queue.mode === 'stopped')
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', db: db ? 'up' : 'down', queue, ai: aiMode() })
  })

  await app.register(
    async (api) => {
      await api.register(authRoutes(deps.sms ?? new ConsoleMessageProvider()))
      await api.register(flatRoutes)
      await api.register(billingRoutes)
      await api.register(paymentRoutes)
      await api.register(auditRoutes)
      await api.register(matchingRoutes)
      await api.register(complaintRoutes)
      await api.register(visitorRoutes)
      await api.register(amenityRoutes)
      await api.register(noticeRoutes)
    },
    { prefix: '/api/v1' },
  )

  app.decorate('scheduler', scheduler)
  return app as unknown as FastifyInstance
}

declare module 'fastify' {
  interface FastifyInstance {
    scheduler: Scheduler
  }
}
