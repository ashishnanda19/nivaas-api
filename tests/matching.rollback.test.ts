import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

let failNext = false
vi.mock('../src/modules/billing/ledger.js', async (orig) => {
  const real = await orig<typeof import('../src/modules/billing/ledger.js')>()
  return {
    ...real,
    postPaymentEntries: async (...a: Parameters<typeof real.postPaymentEntries>) => {
      await real.postPaymentEntries(...a) // ledger rows are written, then the transaction blows up
      if (failNext) throw new Error('disk on fire')
    },
  }
})

import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, multipart, PHONES, SAMPLE_CSV, seedFixture } from './helpers.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  failNext = false
})
afterAll(async () => prisma.$disconnect())

describe('transaction rollback', () => {
  it('a failure after the ledger write leaves no payment, ledger entry, receipt, known payer or posted row', async () => {
    const hd = await login(app, PHONES.helpdesk)
    const m = multipart('s.csv', SAMPLE_CSV)
    const up = (await app.inject({ method: 'POST', url: '/api/v1/matching/uploads', headers: { ...auth(hd), ...m.headers }, payload: m.payload })).json()
    const exact = up.rows.find((r: { confidence: string }) => r.confidence === 'EXACT')
    const ledgerBefore = await prisma.ledgerEntry.count()
    failNext = true
    const r = await app.inject({ method: 'POST', url: `/api/v1/matching/rows/${exact.id}/post`, headers: auth(hd), payload: {} })
    expect(r.statusCode).toBe(500)
    expect(await prisma.payment.count()).toBe(0)
    expect(await prisma.receipt.count()).toBe(0)
    expect(await prisma.knownPayer.count()).toBe(0)
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore)
    expect((await prisma.bankStatementRow.findUniqueOrThrow({ where: { id: exact.id } })).state).toBe('PENDING')
    // and it can be retried once the fault is gone
    failNext = false
    expect((await app.inject({ method: 'POST', url: `/api/v1/matching/rows/${exact.id}/post`, headers: auth(hd), payload: {} })).statusCode).toBe(200)
    expect(await prisma.payment.count()).toBe(1)
  })
})
