import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'
import { allocate, flatDues } from '../src/modules/billing/ledger.js'
import { billRunPublish, runLateFees } from '../src/modules/billing/service.js'
import { systemActor } from '../src/modules/audit/service.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
})
afterAll(async () => prisma.$disconnect())

const get = (url: string, token: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: auth(token) })

describe('bills', () => {
  it('shows the seeded bills with the right amounts', async () => {
    const tSwati = await login(app, PHONES.swati)
    const b = (await get('/billing/bill?flatId=T12-0408', tSwati)).json()
    expect(b).toMatchObject({ billedPaise: 637000, outstandingPaise: 637000, status: 'overdue', daysOverdue: 47 })
    const tAamir = await login(app, PHONES.aamir)
    const a = (await get('/billing/bill?flatId=T21-1601', tAamir)).json()
    expect(a).toMatchObject({ billedPaise: 1066000, paidPaise: 500000, outstandingPaise: 566000, daysOverdue: 18 })
    const tN = await login(app, PHONES.neeraj)
    expect((await get('/billing/bill?flatId=T07-1203', tN)).json()).toMatchObject({ billedPaise: 747500, outstandingPaise: 0, status: 'paid' })
  })

  it('ledger running balance follows every entry', async () => {
    const t = await login(app, PHONES.aamir)
    const l = (await get('/billing/ledger?flatId=T21-1601', t)).json()
    expect(l.items.map((e: { balancePaise: number }) => e.balancePaise)).toEqual([566000, 1066000])
  })

  it('bill run is idempotent per flat and month', async () => {
    const first = await billRunPublish('2027-01', systemActor)
    expect(first.created).toBe(3)
    const second = await billRunPublish('2027-01', systemActor)
    expect(second).toMatchObject({ created: 0, skipped: 3 })
    expect(await prisma.bill.count({ where: { period: '2027-01' } })).toBe(3)
    expect(await prisma.ledgerEntry.count({ where: { ref: 'BILL:2027-01' } })).toBe(3)
  })

  it('preview needs the help desk and lists only unbilled flats', async () => {
    const res = await login(app, PHONES.neeraj)
    expect((await get('/billing/runs/preview?period=2027-02', res)).statusCode).toBe(403)
    const hd = await login(app, PHONES.helpdesk)
    const p = (await get('/billing/runs/preview?period=2027-02', hd)).json()
    expect(p).toMatchObject({ flats: 3, totalPaise: 747500 + 637000 + 1066000 })
  })
})

describe('ledger', () => {
  it('is append only at the database level', async () => {
    await expect(prisma.ledgerEntry.updateMany({ data: { description: 'x' } })).rejects.toThrow(/append-only/)
    await expect(prisma.ledgerEntry.deleteMany({})).rejects.toThrow(/append-only/)
  })

  it('corrections are reversal entries, applied once', async () => {
    const hd = await login(app, PHONES.helpdesk)
    const pay = await prisma.ledgerEntry.findFirstOrThrow({ where: { flatId: 'T21-1601', type: 'PAYMENT' } })
    const body = { flatId: 'T21-1601', reason: 'Cheque bounced' }
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/billing/ledger/${pay.id}/reverse`, headers: auth(hd), payload: body })
    expect(r1.statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/api/v1/billing/ledger/${pay.id}/reverse`, headers: auth(hd), payload: body })
    const dues = await flatDues(prisma, 'T21-1601')
    expect(dues.balancePaise).toBe(1066000)
    expect(await prisma.ledgerEntry.count({ where: { type: 'REVERSAL' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'ledger.reverse' } })).toBe(1)
  })

  it('allocates credits to the oldest charge first', () => {
    const d = allocate([
      { type: 'BILL', amountPaise: 1000, ref: 'BILL:2026-08', period: '2026-08' },
      { type: 'BILL', amountPaise: 1000, ref: 'BILL:2026-09', period: '2026-09' },
      { type: 'PAYMENT', amountPaise: -1500, ref: 'P1', period: null },
    ])
    expect(d.openBills.map((b) => [b.period, b.remainingPaise])).toEqual([['2026-09', 500]])
    expect(d.balancePaise).toBe(500)
  })

  it('treats overpayment as advance credit', () => {
    const d = allocate([
      { type: 'BILL', amountPaise: 1000, ref: 'BILL:2026-08', period: '2026-08' },
      { type: 'PAYMENT', amountPaise: -1800, ref: 'P1', period: null },
    ])
    expect(d.advancePaise).toBe(800)
    expect(d.balancePaise).toBe(-800)
  })
})

describe('late fee job', () => {
  it('posts accrued fee once and re-running the same day adds nothing', async () => {
    const r1 = await runLateFees()
    expect(r1.posted).toBe(2) // T12 (47 d) and T21 (18 d); T07 is paid
    const r2 = await runLateFees()
    expect(r2.posted).toBe(0)
    const swati = await flatDues(prisma, 'T12-0408')
    expect(swati.balancePaise).toBe(637000 + 17464)
    const fees = await prisma.ledgerEntry.findMany({ where: { type: 'LATE_FEE' } })
    expect(fees).toHaveLength(2)
  })

  it('tops up the delta on a later day', async () => {
    await runLateFees(new Date(Date.now()))
    const later = new Date(Date.now() + 10 * 86400000)
    const r = await runLateFees(later)
    expect(r.posted).toBe(2)
    const bill = await prisma.bill.findFirstOrThrow({ where: { flatId: 'T12-0408' } })
    expect(bill.lateFeePostedPaise).toBe(Math.round((637000 * 175 * 57) / (10000 * 30)))
  })
})
