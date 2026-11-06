import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'
import { Scheduler } from '../src/lib/queue.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
})
afterAll(async () => prisma.$disconnect())

describe('http hardening', () => {
  it('sends security headers and a consistent error shape', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/nope' })
    expect(r.statusCode).toBe(404)
    expect(r.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['x-powered-by']).toBeUndefined()
  })

  it('only allows listed CORS origins', async () => {
    const ok = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } })
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    const bad = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } })
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reports malformed JSON as a 400, not a crash', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', headers: { 'content-type': 'application/json' }, payload: '{bad' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('BAD_JSON')
  })

  it('never echoes internals on a server error', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/billing/bill?flatId=T07-1203', headers: auth(await login(app, PHONES.guard)) })
    expect(r.statusCode).toBe(403)
    expect(JSON.stringify(r.json())).not.toMatch(/prisma|stack|node_modules/i)
  })

  it('throttles the OTP endpoint per IP', async () => {
    let last = 0
    for (let i = 0; i < 25; i++) last = (await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '9999999999' }, remoteAddress: '10.9.9.9' })).statusCode
    expect(last).toBe(429)
  })
})

describe('openapi docs', () => {
  it('serves a spec generated from the real routes and Zod schemas', async () => {
    const r = await app.inject({ method: 'GET', url: '/docs/json' })
    expect(r.statusCode).toBe(200)
    const doc = r.json()
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/v1/billing/bill', '/api/v1/matching/uploads', '/api/v1/complaints/{code}', '/api/v1/visitors/sync']))
    const body = doc.paths['/api/v1/complaints'].post.requestBody.content['application/json'].schema
    expect(body.properties.text.minLength).toBe(10)
    expect(body.additionalProperties).toBe(false)
    for (const [path, method] of [
      ['/api/v1/payments/intents', 'post'], ['/api/v1/matching/rows/{id}/post', 'post'], ['/api/v1/billing/runs', 'post'],
      ['/api/v1/flats/{id}/members', 'post'], ['/api/v1/amenity-bookings', 'post'], ['/api/v1/notices', 'post'], ['/api/v1/payments/webhook', 'post'],
    ])
      expect(doc.paths[path][method].requestBody.content['application/json'].schema.additionalProperties, `${method} ${path}`).toBe(false)
    expect(doc.paths['/api/v1/auth/otp/request'].post.security).toBeUndefined()
    expect(doc.paths['/api/v1/billing/bill'].get.security).toEqual([{ bearer: [] }])
    expect((await app.inject({ method: 'GET', url: '/docs' })).statusCode).toBeLessThan(400)
  })
})

describe('scheduler without redis', () => {
  it('runs a due job once and not again until its interval passes', async () => {
    const s = new Scheduler()
    let runs = 0
    s.register({ name: 'test-job', everyMs: 60_000, run: async () => { runs++ } })
    const t0 = new Date()
    expect(await s.runDue(t0)).toEqual(['test-job'])
    expect(await s.runDue(new Date(t0.getTime() + 30_000))).toEqual([])
    expect(await s.runDue(new Date(t0.getTime() + 61_000))).toEqual(['test-job'])
    expect(runs).toBe(2)
  })

  it('two instances never run the same job twice', async () => {
    const a = new Scheduler(), b = new Scheduler()
    let runs = 0
    for (const s of [a, b]) s.register({ name: 'shared-job', everyMs: 60_000, run: async () => { runs++ } })
    await Promise.all([a.runDue(), b.runDue()])
    expect(runs).toBe(1)
  })

  it('catches up after downtime and records a failure without crashing', async () => {
    const s = new Scheduler()
    s.register({ name: 'bad-job', everyMs: 1000, run: async () => { throw new Error('nope') } })
    await expect(s.runDue()).resolves.toEqual([])
    expect((await prisma.jobState.findUniqueOrThrow({ where: { name: 'bad-job' } })).lastError).toBe('nope')
  })

  it('reports its mode in the health check', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.json().queue).toMatchObject({ mode: 'stopped' })
  })
})
