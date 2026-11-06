import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'
import { ageing, avg, bucketOf, onTimeRate, periodsBack } from '../src/modules/committee/metrics.js'
import { setLlmClients } from '../src/modules/complaints/service.js'

describe('metrics (pure)', () => {
  it('puts days overdue into the four buckets, edges included', () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(bucketOf)).toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+', '90+'])
    expect(ageing([{ remainingPaise: 100, daysOverdue: 5 }, { remainingPaise: 200, daysOverdue: 95 }, { remainingPaise: 0, daysOverdue: 40 }, { remainingPaise: 50, daysOverdue: -3 }]))
      .toEqual([{ bucket: '0-30', amountPaise: 150 }, { bucket: '31-60', amountPaise: 0 }, { bucket: '61-90', amountPaise: 0 }, { bucket: '90+', amountPaise: 200 }])
  })

  it('on-time rate counts bills covered by payments made by the due date', () => {
    const d = (s: string) => new Date(s + 'T00:00:00Z')
    const bills = [
      { flatId: 'A', dueDate: d('2026-09-10'), amountPaise: 100 }, { flatId: 'A', dueDate: d('2026-10-10'), amountPaise: 100 },
      { flatId: 'B', dueDate: d('2026-09-10'), amountPaise: 100 }, { flatId: 'B', dueDate: d('2026-12-10'), amountPaise: 100 },
    ]
    const pays = [
      { flatId: 'A', paidAt: d('2026-09-09'), amountPaise: 100 }, // A pays Sept on time
      { flatId: 'A', paidAt: d('2026-10-25'), amountPaise: 100 }, // A pays Oct late
      { flatId: 'B', paidAt: d('2026-09-20'), amountPaise: 100 }, // B pays Sept late
    ]
    const r = onTimeRate(bills, pays, d('2026-11-06'))
    expect(r).toEqual({ onTime: 1, total: 3, pct: 33.3 }) // B's December bill is not due yet
  })

  it('an advance payment covers later bills on time', () => {
    const d = (s: string) => new Date(s + 'T00:00:00Z')
    const r = onTimeRate(
      [{ flatId: 'A', dueDate: d('2026-09-10'), amountPaise: 100 }, { flatId: 'A', dueDate: d('2026-10-10'), amountPaise: 100 }],
      [{ flatId: 'A', paidAt: d('2026-09-01'), amountPaise: 200 }], d('2026-11-01'),
    )
    expect(r.pct).toBe(100)
  })

  it('helpers', () => {
    expect(avg([1, 2, 4])).toBe(2.3)
    expect(avg([])).toBe(0)
    expect(periodsBack(3, new Date('2026-11-06T00:00:00Z'))).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(periodsBack(2, new Date('2026-01-15T00:00:00Z'))).toEqual(['2025-12', '2026-01'])
  })
})

let app: Awaited<ReturnType<typeof makeApp>>['app']
let committee: string, hd: string, swati: string
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  setLlmClients([])
  ;[committee, hd, swati] = await Promise.all([PHONES.committee, PHONES.helpdesk, PHONES.swati].map((p) => login(app, p)))
})
afterAll(async () => {
  setLlmClients(null)
  await prisma.$disconnect()
})
const get = (url: string, token: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: auth(token) })

describe('committee dashboard', () => {
  it('reports billed, ageing and defaulting towers from the ledger', async () => {
    const d = (await get('/committee/dashboard', committee)).json()
    expect(d.billedTotalPaise).toBe(747500 + 637000 + 1066000)
    expect(d.outstandingPaise).toBe(637000 + 566000)
    expect(d.ageing).toEqual([{ bucket: '0-30', amountPaise: 566000 }, { bucket: '31-60', amountPaise: 637000 }, { bucket: '61-90', amountPaise: 0 }, { bucket: '90+', amountPaise: 0 }])
    expect(d.topDefaultingTowers.map((t: { tower: string }) => t.tower)).toEqual(['T12', 'T21'])
    expect(d.months).toHaveLength(6)
  })

  it('collections follow real payments', async () => {
    const i = (await app.inject({ method: 'POST', url: '/api/v1/payments/intents', headers: auth(swati), payload: { flatId: 'T12-0408', amountPaise: 637000, mode: 'UPI' } })).json()
    await app.inject({ method: 'POST', url: `/api/v1/gateway/pay/${i.paymentId}`, headers: auth(swati), payload: { outcome: 'success' } })
    const d = (await get('/committee/dashboard', committee)).json()
    expect(d.collectedTotalPaise).toBe(637000)
    expect(d.outstandingPaise).toBe(566000)
    expect(d.ageing.find((a: { bucket: string }) => a.bucket === '31-60').amountPaise).toBe(0)
  })

  it('complaint metrics: volume, response, resolution and reopened rate', async () => {
    const mk = async (text: string) => (await app.inject({ method: 'POST', url: '/api/v1/complaints', headers: auth(swati), payload: { flatId: 'T12-0408', text } })).json().id as string
    const a = await mk('Water is leaking from the tap in the bathroom')
    await mk('Gas smell in the kitchen near the cylinder')
    await mk('Garbage is piled up outside the tower entrance')
    await prisma.complaint.update({ where: { code: a }, data: { createdAt: new Date(Date.now() - 6 * 3600e3) } })
    await app.inject({ method: 'POST', url: `/api/v1/complaints/${a}/status`, headers: auth(hd), payload: { status: 'RESOLVED' } })
    await app.inject({ method: 'POST', url: `/api/v1/complaints/${a}/reopen`, headers: auth(swati) })
    const c = (await get('/committee/complaints', committee)).json()
    expect(c.volumeByWeek.reduce((s: number, w: { count: number }) => s + w.count, 0)).toBe(3)
    expect(c.escalated).toBe(1)
    expect(c.open).toBe(3) // a was reopened
    expect(c.reopenedPct).toBe(100)
    expect(c.byCategory[0].count).toBeGreaterThan(0)
  })

  it('is read only for the committee and closed to residents and guards', async () => {
    expect((await get('/committee/dashboard', swati)).statusCode).toBe(403)
    expect((await get('/committee/dashboard', await login(app, PHONES.guard))).statusCode).toBe(403)
    expect((await get('/committee/dashboard?months=24', committee)).statusCode).toBe(400)
    expect((await get('/committee/dashboard', hd)).statusCode).toBe(200)
  })
})

describe('report export', () => {
  const period = new Date().toISOString().slice(0, 7)
  it('exports csv with aggregates only and records the export', async () => {
    const r = await get(`/committee/report.csv?period=${period}`, committee)
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toMatch(/text\/csv/)
    expect(r.body).toMatch(/Section,Item,Value/)
    expect(r.body).toMatch(/Dues ageing/)
    expect(r.body).not.toMatch(/Swati|Neeraj|9000000/)
    expect(await prisma.auditLog.count({ where: { action: 'report.export' } })).toBe(1)
  })
  it('neutralises spreadsheet formulas in text cells', async () => {
    await prisma.society.updateMany({ data: { name: '=HYPERLINK("http://evil")' } })
    const r = await get(`/committee/report.csv?period=${period}`, committee)
    expect(r.body).toContain(`"'=HYPERLINK(""http://evil"")"`)
  })
  it('exports a pdf', async () => {
    const r = await get(`/committee/report.pdf?period=${period}`, committee)
    expect(r.statusCode).toBe(200)
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
  })
  it('rejects a bad period and residents', async () => {
    expect((await get('/committee/report.csv?period=2026-13', committee)).statusCode).toBe(400)
    expect((await get(`/committee/report.pdf?period=${period}`, swati)).statusCode).toBe(403)
  })
})

describe('tower filter and bill run list', () => {
  it('narrows the dashboard to one tower', async () => {
    const all = (await get('/committee/dashboard', committee)).json()
    const t12 = (await get('/committee/dashboard?tower=12', committee)).json()
    expect(all.outstandingPaise).toBe(637000 + 566000)
    expect(t12.outstandingPaise).toBe(637000)
    expect(t12.billedTotalPaise).toBe(637000)
    expect(t12.topDefaultingTowers.map((t: { tower: string }) => t.tower)).toEqual(['T12'])
    expect((await get('/committee/dashboard?tower=40', committee)).statusCode).toBe(400)
  })

  it('lists published bill runs for the help desk only', async () => {
    const r = (await get('/billing/runs', hd)).json().items
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]).toMatchObject({ bills: expect.any(Number), totalPaise: expect.any(Number), label: expect.any(String) })
    expect((await get('/billing/runs', swati)).statusCode).toBe(403)
  })
})
