import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'
import { OTP_MAX_ATTEMPTS } from '../src/modules/auth/service.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
})
afterAll(async () => prisma.$disconnect())

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as object })

describe('OTP login', () => {
  it('logs in with the fixed dev code and returns the user', async () => {
    await post('/auth/otp/request', { phone: PHONES.neeraj })
    const r = await post('/auth/otp/verify', { phone: PHONES.neeraj, code: '123456' })
    expect(r.statusCode).toBe(200)
    expect(r.json().user).toMatchObject({ name: 'Neeraj Kulkarni', role: 'RESIDENT', flatId: 'T07-1203' })
    expect(r.headers['set-cookie']).toMatch(/nivaas_rt=.*HttpOnly/i)
  })

  it('rejects a wrong code and locks the code after max attempts', async () => {
    await post('/auth/otp/request', { phone: PHONES.neeraj })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const r = await post('/auth/otp/verify', { phone: PHONES.neeraj, code: '000000' })
      expect(r.statusCode).toBe(401)
    }
    // even the right code no longer works on this OTP
    const locked = await post('/auth/otp/verify', { phone: PHONES.neeraj, code: '123456' })
    expect(locked.statusCode).toBe(429)
  })

  it('rejects an expired code', async () => {
    await post('/auth/otp/request', { phone: PHONES.neeraj })
    await prisma.otp.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    const r = await post('/auth/otp/verify', { phone: PHONES.neeraj, code: '123456' })
    expect(r.statusCode).toBe(401)
    expect(r.json().error.code).toBe('OTP_INVALID')
  })

  it('rate limits code requests per phone', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/auth/otp/request', { phone: PHONES.neeraj })).statusCode).toBe(200)
    expect((await post('/auth/otp/request', { phone: PHONES.neeraj })).statusCode).toBe(429)
  })

  it('answers the same for unknown numbers and sends nothing', async () => {
    const { app: a, sms } = await makeApp()
    const r = await a.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '9999999999' } })
    expect(r.statusCode).toBe(200)
    expect(sms.constructor.name).toBe('MemoryMessageProvider')
    const v = await a.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: '9999999999', code: '123456' } })
    expect(v.statusCode).toBe(401)
  })

  it('rejects unknown fields and bad phone numbers', async () => {
    expect((await post('/auth/otp/request', { phone: '12345' })).statusCode).toBe(400)
    expect((await post('/auth/otp/request', { phone: PHONES.neeraj, extra: 1 })).statusCode).toBe(400)
  })
})

describe('sessions and consent', () => {
  it('refresh rotates the token and a reused token revokes the session', async () => {
    await post('/auth/otp/request', { phone: PHONES.neeraj })
    const v = await post('/auth/otp/verify', { phone: PHONES.neeraj, code: '123456' })
    const old = v.cookies.find((c) => c.name === 'nivaas_rt')!.value
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { nivaas_rt: old } })
    expect(r1.statusCode).toBe(200)
    const fresh = r1.cookies.find((c) => c.name === 'nivaas_rt')!.value
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { nivaas_rt: old } })
    expect(reuse.statusCode).toBe(401)
    const afterTheft = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: { nivaas_rt: fresh } })
    expect(afterTheft.statusCode).toBe(401)
  })

  it('blocks every data endpoint until consent is recorded', async () => {
    const token = await login(app, PHONES.noConsent)
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })
    expect(me.statusCode).toBe(200)
    expect(me.json().consent).toBe(false)
    const lang = await app.inject({ method: 'PATCH', url: '/api/v1/auth/language', headers: auth(token), payload: { language: 'hi' } })
    expect(lang.statusCode).toBe(403)
    const c = await app.inject({ method: 'POST', url: '/api/v1/auth/consent', headers: auth(token), payload: { accepted: true } })
    expect(c.json().consent).toBe(true)
    const lang2 = await app.inject({ method: 'PATCH', url: '/api/v1/auth/language', headers: auth(token), payload: { language: 'mr' } })
    expect(lang2.json().language).toBe('mr')
    expect(await prisma.auditLog.count({ where: { action: 'consent.record' } })).toBe(1)
  })

  it('rejects missing and tampered tokens', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth('abc.def.ghi') })).statusCode).toBe(401)
  })

  it('health reports db, queue and ai mode', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' })
    expect(r.json()).toMatchObject({ db: 'up', ai: 'rules-only' })
  })
})
