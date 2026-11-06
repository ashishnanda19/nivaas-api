import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
})
afterAll(async () => prisma.$disconnect())

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload })

describe('resident boundaries', () => {
  it("cannot read another flat's bill, ledger, summary or members", async () => {
    const t = await login(app, PHONES.neeraj)
    for (const u of ['/billing/bill?flatId=T12-0408', '/billing/bills?flatId=T12-0408', '/billing/ledger?flatId=T12-0408', '/flats/T12-0408/summary', '/flats/T12-0408/members', '/payments?flatId=T12-0408'])
      expect((await call('GET', u, t)).statusCode, u).toBe(403)
    expect((await call('GET', '/billing/bill?flatId=T07-1203', t)).statusCode).toBe(200)
  })

  it('cannot use staff endpoints', async () => {
    const t = await login(app, PHONES.neeraj)
    for (const u of ['/flats', '/audit', '/billing/runs/preview?period=2027-01'])
      expect((await call('GET', u, t)).statusCode, u).toBe(403)
    expect((await call('POST', '/billing/runs', t, { period: '2027-01' })).statusCode).toBe(403)
  })

  it('family members cannot manage members, owners can', async () => {
    const fam = await login(app, PHONES.neerajSpouse)
    const body = { name: 'Guest Relative', phone: '9111111111', relation: 'FAMILY' }
    expect((await call('POST', '/flats/T07-1203/members', fam, body)).statusCode).toBe(403)
    const owner = await login(app, PHONES.neeraj)
    expect((await call('POST', '/flats/T07-1203/members', owner, body)).statusCode).toBe(200)
    expect((await call('POST', '/flats/T07-1203/members', owner, body)).statusCode).toBe(409)
    const list = (await call('GET', '/flats/T07-1203/members', owner)).json().items
    expect(list).toHaveLength(3)
    // removed member loses access immediately
    const newbie = list.find((m: { name: string }) => m.name === 'Guest Relative')
    await prisma.user.update({ where: { phone: '9111111111' }, data: { consentAt: new Date() } })
    const nt = await login(app, '9111111111')
    expect((await call('GET', '/flats/T07-1203/summary', nt)).statusCode).toBe(200)
    expect((await call('DELETE', `/flats/T07-1203/members/${newbie.id}`, owner)).statusCode).toBe(200)
    expect((await call('GET', '/flats/T07-1203/summary', nt)).statusCode).toBe(403)
  })
})

describe('guard and committee boundaries', () => {
  it('guard cannot read ledgers, bills or flats', async () => {
    const g = await login(app, PHONES.guard)
    for (const u of ['/billing/ledger?flatId=T07-1203', '/billing/bill?flatId=T07-1203', '/flats', '/flats/T07-1203/summary'])
      expect((await call('GET', u, g)).statusCode, u).toBe(403)
  })

  it('committee cannot write anything', async () => {
    const c = await login(app, PHONES.committee)
    expect((await call('POST', '/billing/runs', c, { period: '2027-01' })).statusCode).toBe(403)
    expect((await call('POST', '/payments/intents', c, { flatId: 'T07-1203', amountPaise: 100, mode: 'UPI' })).statusCode).toBe(403)
    expect((await call('POST', '/flats/T07-1203/members', c, { name: 'X Y', phone: '9222222222', relation: 'FAMILY' })).statusCode).toBe(403)
    expect((await call('GET', '/audit', c)).statusCode).toBe(200)
  })

  it('help desk sees masked phones unless it asks, and asking is audited', async () => {
    const hd = await login(app, PHONES.helpdesk)
    const masked = (await call('GET', '/flats/T07-1203/members', hd)).json().items[0].phone
    expect(masked).toMatch(/\*{6}/)
    expect(await prisma.auditLog.count({ where: { action: 'pii.view' } })).toBe(0)
    const shown = (await call('GET', '/flats/T07-1203/members?reveal=true', hd)).json().items[0].phone
    expect(shown).toMatch(/^\d{10}$/)
    expect(await prisma.auditLog.count({ where: { action: 'pii.view' } })).toBe(1)
  })

  it('the flat list is paginated and searchable', async () => {
    const hd = await login(app, PHONES.helpdesk)
    const r = (await call('GET', '/flats?search=swati&pageSize=2', hd)).json()
    expect(r.items.map((f: { id: string }) => f.id)).toEqual(['T12-0408'])
    expect(r).toMatchObject({ page: 1, pageSize: 2, total: 1 })
  })
})
