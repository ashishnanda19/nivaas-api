import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { makeApp, PHONES, seedFixture } from './helpers.js'

// These tests go over a real HTTP socket, so cookies, headers and status lines are exercised as a browser would see them.
let app: Awaited<ReturnType<typeof makeApp>>['app']
beforeAll(async () => {
  await seedFixture()
  app = (await makeApp()).app
  await app.ready()
})
beforeEach(async () => {
  // Login attempts accumulate across tests; clear them so each starts clean.
  await prisma.otp.deleteMany()
})
afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

const api = () => request(app.server)

async function signIn(phone: string) {
  await api().post('/api/v1/auth/otp/request').send({ phone }).expect(200)
  const res = await api().post('/api/v1/auth/otp/verify').send({ phone, code: '123456' }).expect(200)
  return { token: res.body.accessToken as string, cookies: res.headers['set-cookie'] as unknown as string[] }
}

describe('over HTTP', () => {
  it('reports health with database and queue state', async () => {
    const res = await api().get('/health').expect(200)
    expect(res.body.db).toBe('up')
    expect(res.body.queue).toBeDefined()
    expect(res.body.ai).toBeDefined()
  })

  it('rejects a protected route without a token, in the standard error shape', async () => {
    const res = await api().get('/api/v1/auth/me').expect(401)
    expect(res.body.error.code).toBeTruthy()
    expect(res.body.error.message).toBeTruthy()
  })

  it('sets the refresh token as an httpOnly cookie and rotates it', async () => {
    const { cookies } = await signIn(PHONES.neeraj)
    const refresh = cookies.find((c) => c.includes('HttpOnly'))
    expect(refresh).toBeTruthy()
    const first = await api().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(200)
    expect(first.body.accessToken).toBeTruthy()
    // The old cookie was rotated away: presenting it again is refused.
    await api().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(401)
  })

  it('lets a resident read their own bill and refuses another flat', async () => {
    const { token } = await signIn(PHONES.neeraj)
    const own = await api().get('/api/v1/billing/bill?flatId=T07-1203').set('Authorization', `Bearer ${token}`).expect(200)
    expect(own.body.flatId).toBe('T07-1203')
    await api().get('/api/v1/billing/bill?flatId=T12-0408').set('Authorization', `Bearer ${token}`).expect(403)
  })

  it('lets the help desk list flats but keeps the guard out of the ledger', async () => {
    const desk = await signIn(PHONES.helpdesk)
    const flats = await api().get('/api/v1/flats').set('Authorization', `Bearer ${desk.token}`).expect(200)
    expect(flats.body.total).toBe(3)
    const guard = await signIn(PHONES.guard)
    await api().get('/api/v1/billing/ledger?flatId=T07-1203').set('Authorization', `Bearer ${guard.token}`).expect(403)
  })

  it('keeps the committee read-only', async () => {
    const { token } = await signIn(PHONES.committee)
    await api().get('/api/v1/committee/dashboard').set('Authorization', `Bearer ${token}`).expect(200)
    await api().post('/api/v1/notices').set('Authorization', `Bearer ${token}`).send({ title: 'Hello there', body: 'Not allowed for committee' }).expect(403)
  })

  it('rejects unknown fields in a request body', async () => {
    const { token } = await signIn(PHONES.helpdesk)
    const res = await api().post('/api/v1/notices').set('Authorization', `Bearer ${token}`).send({ title: 'Water cut', body: 'Tomorrow 10 to 12', sneaky: true })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBeTruthy()
  })

  it('answers the browser preflight for every method the app uses, for an allowed origin only', async () => {
    const allowed = [...(await import('../src/lib/config.js')).config.corsOrigins][0]
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const res = await api().options('/api/v1/auth/language').set('Origin', allowed).set('Access-Control-Request-Method', method).set('Access-Control-Request-Headers', 'content-type,authorization')
      expect(res.status, method).toBe(204)
      expect(res.headers['access-control-allow-methods']).toContain(method)
      expect(res.headers['access-control-allow-origin']).toBe(allowed)
    }
    const evil = await api().options('/api/v1/auth/language').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'PATCH')
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('serves the ledger with page parameters, as the web app asks for it', async () => {
    const { token } = await signIn(PHONES.neeraj)
    const res = await api().get('/api/v1/billing/ledger?flatId=T07-1203&page=1&pageSize=100').set('Authorization', `Bearer ${token}`).expect(200)
    expect(res.body).toMatchObject({ page: 1, pageSize: 100 })
    expect(Array.isArray(res.body.items)).toBe(true)
    await api().get('/api/v1/billing/ledger?flatId=T07-1203&pageSize=500').set('Authorization', `Bearer ${token}`).expect(400)
  })
})

describe('connection settings behind a proxy', () => {
  it('keeps idle connections open longer than the 60 second proxies in front of it', async () => {
    const { buildApp, KEEP_ALIVE_MS } = await import('../src/app.js')
    const app = await buildApp()
    expect(KEEP_ALIVE_MS).toBeGreaterThan(60_000)
    expect(app.server.keepAliveTimeout).toBe(KEEP_ALIVE_MS)
    expect(app.server.headersTimeout).toBeGreaterThan(app.server.keepAliveTimeout)
    await app.close()
  })
})
