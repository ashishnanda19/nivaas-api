import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'
import { flatDues } from '../src/modules/billing/ledger.js'
import { sign } from '../src/modules/payments/service.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
let tSwati: string
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  tSwati = await login(app, PHONES.swati)
})
afterAll(async () => prisma.$disconnect())

const intent = (token: string, body: object, key?: string) =>
  app.inject({ method: 'POST', url: '/api/v1/payments/intents', headers: { ...auth(token), ...(key ? { 'idempotency-key': key } : {}) }, payload: body })
const pay = (token: string, id: string, outcome: string) =>
  app.inject({ method: 'POST', url: `/api/v1/gateway/pay/${id}`, headers: auth(token), payload: { outcome } })

describe('test-mode payments', () => {
  it('pays a bill in full: ledger, bill status and receipt', async () => {
    const i = (await intent(tSwati, { flatId: 'T12-0408', amountPaise: 637000, mode: 'UPI' })).json()
    expect(i.status).toBe('PENDING')
    const done = await pay(tSwati, i.paymentId, 'success')
    expect(done.json()).toMatchObject({ status: 'SUCCESS', amountPaise: 637000 })
    expect(done.json().receiptNumber).toMatch(/^NIV-\d{4}-000001$/)
    expect((await flatDues(prisma, 'T12-0408')).balancePaise).toBe(0)
    expect((await prisma.bill.findFirstOrThrow({ where: { flatId: 'T12-0408' } })).status).toBe('PAID')
    const pdf = await app.inject({ method: 'GET', url: `/api/v1/payments/${i.paymentId}/receipt.pdf`, headers: auth(tSwati) })
    expect(pdf.statusCode).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('a double click with the same idempotency key creates and posts one payment', async () => {
    const body = { flatId: 'T12-0408', amountPaise: 100000, mode: 'CARD' }
    const [a, b] = await Promise.all([intent(tSwati, body, 'k1'), intent(tSwati, body, 'k1')])
    expect(a.json().paymentId).toBe(b.json().paymentId)
    expect(await prisma.payment.count()).toBe(1)
    const id = a.json().paymentId
    await pay(tSwati, id, 'success')
    await pay(tSwati, id, 'success')
    expect(await prisma.ledgerEntry.count({ where: { type: 'PAYMENT', flatId: 'T12-0408' } })).toBe(1)
    expect((await flatDues(prisma, 'T12-0408')).balancePaise).toBe(537000)
  })

  it('a failed payment posts nothing and cannot be flipped to success afterwards', async () => {
    const i = (await intent(tSwati, { flatId: 'T12-0408', amountPaise: 637000, mode: 'NETBANKING' })).json()
    expect((await pay(tSwati, i.paymentId, 'failure')).json().status).toBe('FAILED')
    await pay(tSwati, i.paymentId, 'success')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: i.paymentId } })).status).toBe('FAILED')
    expect((await flatDues(prisma, 'T12-0408')).balancePaise).toBe(637000)
  })

  it('overpayment becomes advance credit', async () => {
    const i = (await intent(tSwati, { flatId: 'T12-0408', amountPaise: 700000, mode: 'UPI' })).json()
    await pay(tSwati, i.paymentId, 'success')
    const d = await flatDues(prisma, 'T12-0408')
    expect(d.advancePaise).toBe(63000)
    expect(d.balancePaise).toBe(-63000)
  })

  it('webhook needs a valid signature', async () => {
    const i = (await intent(tSwati, { flatId: 'T12-0408', amountPaise: 100000, mode: 'UPI' })).json()
    const payload = JSON.stringify({ paymentId: i.paymentId, status: 'success' })
    const bad = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload, headers: { 'content-type': 'application/json', 'x-signature': 'deadbeef' } })
    expect(bad.statusCode).toBe(403)
    const none = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload, headers: { 'content-type': 'application/json' } })
    expect(none.statusCode).toBe(403)
    const ok = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload, headers: { 'content-type': 'application/json', 'x-signature': sign(payload) } })
    expect(ok.statusCode).toBe(200)
    // a signature for a different body does not validate
    const tampered = JSON.stringify({ paymentId: i.paymentId, status: 'success', extra: 1 })
    const t = await app.inject({ method: 'POST', url: '/api/v1/payments/webhook', payload: tampered, headers: { 'content-type': 'application/json', 'x-signature': sign(payload) } })
    expect(t.statusCode).toBe(403)
  })

  it('a resident cannot pay for or read another flat', async () => {
    const r = await intent(tSwati, { flatId: 'T21-1601', amountPaise: 100000, mode: 'UPI' })
    expect(r.statusCode).toBe(403)
    const mine = (await intent(tSwati, { flatId: 'T12-0408', amountPaise: 100000, mode: 'UPI' })).json()
    const tAamir = await login(app, PHONES.aamir)
    expect((await pay(tAamir, mine.paymentId, 'success')).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: `/api/v1/payments/${mine.paymentId}`, headers: auth(tAamir) })).statusCode).toBe(403)
  })
})
