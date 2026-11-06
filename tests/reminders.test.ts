import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { appendLedger } from '../src/modules/billing/ledger.js'
import { MemoryMessageProvider, sentMessages } from '../src/modules/auth/messages.js'
import { reminderKindFor, runReminders } from '../src/modules/reminders/service.js'
import { reminderText } from '../src/modules/reminders/messages.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'

afterAll(async () => prisma.$disconnect())
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)
/** A bill's due date is stored as a calendar date at midnight UTC. */
const dueIn = (days: number, from = new Date()) => new Date(`${istDay(new Date(from.getTime() + days * 86400000))}T00:00:00.000Z`)

describe('which reminder is due today', () => {
  const now = new Date('2026-11-10T09:00:00+05:30')
  it.each([
    [5, null], [4, null], [3, 'BEFORE_DUE'], [2, 'BEFORE_DUE'], [1, 'BEFORE_DUE'], [0, 'ON_DUE'],
    [-1, null], [-4, null], [-5, 'OVERDUE'], [-6, 'OVERDUE'], [-47, 'OVERDUE'],
  ])('a bill due %i days from now gets %s', (offset, kind) => {
    expect(reminderKindFor(dueIn(offset, now), now)?.kind ?? null).toBe(kind)
  })
  it('counts the day in India time, not UTC', () => {
    // 00:30 IST on the 10th is still the 9th in UTC: a bill due on the 10th is due today, not tomorrow.
    const lateNight = new Date('2026-11-10T00:30:00+05:30')
    expect(reminderKindFor(new Date('2026-11-10T00:00:00.000Z'), lateNight)?.kind).toBe('ON_DUE')
  })
})

describe('wording', () => {
  const v = { name: 'Swati Joshi', flatId: 'T12-0408', period: 'September 2026', amountPaise: 654464, dueDate: '10/09/2026', daysOverdue: 47 }
  it('is written in English, Hindi and Marathi with the amount and flat', () => {
    for (const lang of ['en', 'hi', 'mr']) {
      const t = reminderText('OVERDUE', lang, v)
      expect(t).toContain('T12-0408')
      expect(t).toContain('₹6,545')
      expect(t).toContain('47')
      expect(t).toContain('Swati')
      expect(t).not.toContain('Joshi')
    }
    expect(reminderText('OVERDUE', 'hi', v)).toMatch(/बकाया/)
    expect(reminderText('OVERDUE', 'mr', v)).toMatch(/थकले/)
    expect(reminderText('OVERDUE', 'fr', v)).toMatch(/^Hello/) // unknown language falls back to English
  })
})

describe('the daily job', () => {
  beforeEach(async () => {
    await seedFixture()
    sentMessages.length = 0
  })

  it('reminds the overdue payers once, never the person who has paid', async () => {
    const sms = new MemoryMessageProvider()
    const first = await runReminders(sms)
    // Swati (47 days) and Aamir (18 days) are overdue; Neeraj paid in full.
    expect(first).toMatchObject({ sent: 2, failed: 0 })
    expect(sentMessages.map((m) => m.phone).sort()).toEqual([PHONES.swati, PHONES.aamir].sort())
    expect(sentMessages.some((m) => m.phone === PHONES.neeraj)).toBe(false)
    const second = await runReminders(sms)
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(2)
    expect(sentMessages).toHaveLength(2)
    expect(await prisma.reminder.count()).toBe(2)
  })

  it('writes the message in the resident\'s language and records it', async () => {
    await prisma.user.update({ where: { phone: PHONES.swati }, data: { language: 'hi' } })
    await runReminders(new MemoryMessageProvider())
    const hi = sentMessages.find((m) => m.phone === PHONES.swati)!
    expect(hi.text).toMatch(/बकाया/)
    const row = await prisma.reminder.findFirstOrThrow({ where: { flatId: 'T12-0408' } })
    expect(row).toMatchObject({ kind: 'OVERDUE', language: 'hi', status: 'SENT' })
  })

  it('sends the early reminder to owners and tenants only, not family members', async () => {
    const period = 'next'
    const due = dueIn(2)
    await prisma.$transaction(async (tx) => {
      await tx.bill.create({ data: { flatId: 'T07-1203', period, areaSqft: 1150, ratePaise: 650, amountPaise: 747500, dueDate: due } })
      await appendLedger(tx, { flatId: 'T07-1203', type: 'BILL', amountPaise: 747500, ref: `BILL:${period}`, description: 'Maintenance next', period })
    })
    await runReminders(new MemoryMessageProvider())
    const toT07 = sentMessages.filter((m) => /T07-1203/.test(m.text))
    expect(toT07.map((m) => m.phone)).toEqual([PHONES.neeraj])
    expect(toT07[0].text).toMatch(/due on/)
    expect(sentMessages.some((m) => m.phone === PHONES.neerajSpouse)).toBe(false)
  })

  it('stops reminding once the bill is paid', async () => {
    await runReminders(new MemoryMessageProvider())
    sentMessages.length = 0
    const bill = await prisma.bill.findFirstOrThrow({ where: { flatId: 'T12-0408' } })
    await prisma.$transaction((tx) => appendLedger(tx, { flatId: 'T12-0408', type: 'PAYMENT', amountPaise: -bill.amountPaise, ref: 'PAY:test-full', description: 'Paid' }))
    const r = await runReminders(new MemoryMessageProvider(), new Date(Date.now() + 10 * 86400000))
    expect(sentMessages.some((m) => /T12-0408/.test(m.text))).toBe(false)
    expect(r.sent).toBeLessThanOrEqual(1) // at most Aamir's own reminder window, never Swati
  })

  it('records a failed send and tries again on the next run', async () => {
    let calls = 0
    const flaky = { sendSms: async () => { if (++calls <= 2) throw new Error('gateway down') } }
    const a = await runReminders(flaky)
    expect(a).toMatchObject({ sent: 0, failed: 2 })
    expect((await prisma.reminder.findMany()).every((r) => r.status === 'FAILED')).toBe(true)
    const b = await runReminders(flaky)
    expect(b).toMatchObject({ sent: 2, failed: 0 })
    expect(await prisma.reminder.count()).toBe(2) // retried in place, not duplicated
    expect((await prisma.reminder.findMany()).every((r) => r.status === 'SENT')).toBe(true)
  })
})

describe('the reminders log', () => {
  let app: Awaited<ReturnType<typeof makeApp>>['app']
  beforeEach(async () => {
    await seedFixture()
    app = (await makeApp()).app
  })
  const get = (url: string, token: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: auth(token) })

  it('is readable by help desk and committee, with phone numbers masked', async () => {
    const desk = await login(app, PHONES.helpdesk)
    const run = await app.inject({ method: 'POST', url: '/api/v1/reminders/run', headers: auth(desk) })
    expect(run.statusCode).toBe(200)
    expect(run.json().sent).toBe(2)
    for (const phone of [PHONES.helpdesk, PHONES.committee]) {
      const r = await get('/reminders', await login(app, phone))
      expect(r.statusCode).toBe(200)
      const body = r.json()
      expect(body.total).toBe(2)
      expect(body.items[0].phone).toMatch(/\*\*\*/)
      expect(JSON.stringify(body)).not.toContain(PHONES.swati)
    }
    expect((await get('/reminders?kind=BEFORE_DUE', desk)).json().total).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'reminders.run' } })).toBe(1)
  })

  it('is closed to residents and guards, and only the help desk can run it', async () => {
    for (const phone of [PHONES.neeraj, PHONES.guard]) expect((await get('/reminders', await login(app, phone))).statusCode).toBe(403)
    const committee = await login(app, PHONES.committee)
    expect((await app.inject({ method: 'POST', url: '/api/v1/reminders/run', headers: auth(committee) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/v1/reminders/run', headers: auth(await login(app, PHONES.neeraj)) })).statusCode).toBe(403)
  })
})
