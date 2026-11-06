import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, multipart, PHONES, SAMPLE_CSV, seedFixture } from './helpers.js'
import { flatDues } from '../src/modules/billing/ledger.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
let hd: string
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  hd = await login(app, PHONES.helpdesk)
})
afterAll(async () => prisma.$disconnect())

async function upload(csv = SAMPLE_CSV, name = 'statement.csv', token = hd) {
  const m = multipart(name, csv)
  return app.inject({ method: 'POST', url: '/api/v1/matching/uploads', headers: { ...auth(token), ...m.headers }, payload: m.payload })
}
const post = (rowId: string, body: object = {}, token = hd) =>
  app.inject({ method: 'POST', url: `/api/v1/matching/rows/${rowId}/post`, headers: auth(token), payload: body })

describe('upload', () => {
  it('only suggests: nothing is posted by uploading', async () => {
    const r = await upload()
    expect(r.statusCode).toBe(200)
    expect(await prisma.payment.count()).toBe(0)
    expect(await prisma.ledgerEntry.count({ where: { type: 'PAYMENT' } })).toBe(2) // only the fixture's own seed payments
    const rows = r.json().rows as { lineNo: number; confidence: string; label: string | null; state: string }[]
    const by = (n: number) => rows.find((x) => x.lineNo === n)!
    expect(by(2)).toMatchObject({ confidence: 'EXACT', state: 'PENDING' })
    expect(by(3)).toMatchObject({ confidence: 'LIKELY', label: 'duplicate', state: 'QUEUED' })
    expect(by(4)).toMatchObject({ confidence: 'LIKELY', label: 'partial', state: 'QUEUED' })
    expect(by(5)).toMatchObject({ confidence: 'LIKELY', label: 'two_month', state: 'QUEUED' })
    expect(by(6)).toMatchObject({ confidence: 'UNCLEAR', state: 'QUEUED' })
    expect(by(7)).toMatchObject({ confidence: 'LIKELY', label: 'already_paid' })
  })

  it('reports parse errors per row and keeps the good rows', async () => {
    const r = await upload('Date,Amount,Reference\n05/11/2026,6370,T12-0408\nbad,1,x\n')
    expect(r.json().total).toBe(1)
    expect(r.json().parseErrors).toHaveLength(1)
  })

  it('is for the help desk only', async () => {
    for (const phone of [PHONES.neeraj, PHONES.committee, PHONES.guard]) {
      const t = await login(app, phone)
      expect((await upload(SAMPLE_CSV, 'a.csv', t)).statusCode, phone).toBe(403)
    }
  })

  it('rejects non-csv names, binary content and oversized files', async () => {
    expect((await upload(SAMPLE_CSV, 'statement.exe')).statusCode).toBe(400)
    expect((await upload('Date,Amount\n\u0000\u0000', 'a.csv')).statusCode).toBe(400)
    const big = 'Date,Amount,Reference\n' + '05/11/2026,100,'.padEnd(80, 'x') + '\n'
    expect((await upload(big.repeat(15000), 'big.csv')).statusCode).toBe(413)
  })
})

describe('posting safety', () => {
  it('post-all-exact posts only the exact rows', async () => {
    const up = (await upload()).json()
    const res = await app.inject({ method: 'POST', url: `/api/v1/matching/uploads/${up.id}/post-all-exact`, headers: auth(hd) })
    expect(res.json()).toMatchObject({ posted: 1 })
    expect(await prisma.payment.count()).toBe(1)
    const swati = await flatDues(prisma, 'T12-0408')
    expect(swati.balancePaise).toBe(0)
    const states = await prisma.bankStatementRow.groupBy({ by: ['state'], _count: true })
    expect(Object.fromEntries(states.map((s) => [s.state, s._count]))).toEqual({ POSTED: 1, QUEUED: 5 })
    // running twice posts nothing more
    const again = await app.inject({ method: 'POST', url: `/api/v1/matching/uploads/${up.id}/post-all-exact`, headers: auth(hd) })
    expect(again.json().posted).toBe(0)
    expect(await prisma.payment.count()).toBe(1)
  })

  it('learns the payer only from a confirmed posting', async () => {
    const up = (await upload()).json()
    expect(await prisma.knownPayer.count()).toBe(0)
    await app.inject({ method: 'POST', url: `/api/v1/matching/uploads/${up.id}/post-all-exact`, headers: auth(hd) })
    expect(await prisma.knownPayer.findMany()).toMatchObject([{ flatId: 'T12-0408', upiId: 'swati.j@ybl' }])
  })

  it('posting the same row twice makes one payment and one ledger entry', async () => {
    const up = (await upload()).json()
    const exact = up.rows.find((r: { confidence: string }) => r.confidence === 'EXACT')
    const [a, b] = await Promise.all([post(exact.id), post(exact.id)])
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    expect(await prisma.payment.count()).toBe(1)
    expect(await prisma.ledgerEntry.count({ where: { flatId: 'T12-0408', type: 'PAYMENT' } })).toBe(1)
  })

  it('likely and unclear rows need a person to choose the flat', async () => {
    const up = (await upload()).json()
    const partial = up.rows.find((r: { label: string }) => r.label === 'partial')
    const unclear = up.rows.find((r: { confidence: string }) => r.confidence === 'UNCLEAR')
    expect((await post(partial.id)).statusCode).toBe(400)
    expect((await post(unclear.id)).statusCode).toBe(400)
    expect(await prisma.payment.count()).toBe(0)
    const ok = await post(unclear.id, { flatId: 'T21-1601' })
    expect(ok.statusCode).toBe(200)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'statement.post' } })
    expect(audit.detail).toBe('Flat chosen manually')
  })

  it('partial payment leaves the rest outstanding and overpayment becomes advance credit', async () => {
    const up = (await upload()).json()
    const partial = up.rows.find((r: { label: string }) => r.label === 'partial')
    await post(partial.id, { flatId: 'T12-0408' })
    expect((await flatDues(prisma, 'T12-0408')).balancePaise).toBe(637000 - 300000)
    expect((await prisma.bill.findFirstOrThrow({ where: { flatId: 'T12-0408' } })).status).toBe('PARTIAL')
    const two = up.rows.find((r: { label: string }) => r.label === 'two_month')
    await post(two.id) .then((r) => expect(r.statusCode).toBe(400))
    await post(two.id, { flatId: 'T21-1601' })
    const d = await flatDues(prisma, 'T21-1601')
    expect(d.advancePaise).toBe(2132000 - 566000)
    expect(d.balancePaise).toBe(-(2132000 - 566000))
  })

  it('a duplicate needs an explicit override', async () => {
    const up = (await upload()).json()
    const dup = up.rows.find((r: { label: string }) => r.label === 'duplicate')
    const r1 = await post(dup.id, { flatId: 'T12-0408' })
    expect(r1.statusCode).toBe(409)
    expect(await prisma.payment.count()).toBe(0)
    expect((await post(dup.id, { flatId: 'T12-0408', allowDuplicate: true })).statusCode).toBe(200)
  })

  it('a reference posted earlier is flagged as a duplicate on the next upload', async () => {
    const up = (await upload()).json()
    await app.inject({ method: 'POST', url: `/api/v1/matching/uploads/${up.id}/post-all-exact`, headers: auth(hd) })
    const next = (await upload('Date,Amount,Reference,UPI ID\n09/11/2026,6370,UPI/T12-0408/MAINT,swati.j@ybl\n')).json()
    expect(next.rows[0]).toMatchObject({ label: 'duplicate', state: 'QUEUED' })
    expect(next.rows[0].duplicateOf).toMatch(/earlier posted/)
  })

  it('post-all-exact skips a row whose dues changed after the upload', async () => {
    const up = (await upload()).json()
    // the bill gets paid some other way before the help desk confirms
    const i = (await app.inject({ method: 'POST', url: '/api/v1/payments/intents', headers: auth(await login(app, PHONES.swati)), payload: { flatId: 'T12-0408', amountPaise: 637000, mode: 'UPI' } })).json()
    await app.inject({ method: 'POST', url: `/api/v1/gateway/pay/${i.paymentId}`, headers: auth(await login(app, PHONES.swati)), payload: { outcome: 'success' } })
    const res = (await app.inject({ method: 'POST', url: `/api/v1/matching/uploads/${up.id}/post-all-exact`, headers: auth(hd) })).json()
    expect(res.posted).toBe(0)
    expect(res.skipped).toHaveLength(1)
    expect(await prisma.payment.count({ where: { source: 'BANK_CSV' } })).toBe(0)
  })

  it('rejecting a row posts nothing; a posted row cannot be rejected', async () => {
    const up = (await upload()).json()
    const unclear = up.rows.find((r: { confidence: string }) => r.confidence === 'UNCLEAR')
    expect((await app.inject({ method: 'POST', url: `/api/v1/matching/rows/${unclear.id}/reject`, headers: auth(hd), payload: { reason: 'Not ours' } })).statusCode).toBe(200)
    expect((await post(unclear.id, { flatId: 'T21-1601' })).statusCode).toBe(409)
    const exact = up.rows.find((r: { confidence: string }) => r.confidence === 'EXACT')
    await post(exact.id)
    expect((await app.inject({ method: 'POST', url: `/api/v1/matching/rows/${exact.id}/reject`, headers: auth(hd), payload: { reason: 'Oops' } })).statusCode).toBe(409)
  })

  it('every posting writes an audit row', async () => {
    const up = (await upload()).json()
    await app.inject({ method: 'POST', url: `/api/v1/matching/uploads/${up.id}/post-all-exact`, headers: auth(hd) })
    expect(await prisma.auditLog.count({ where: { action: 'statement.post' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'statement.upload' } })).toBe(1)
  })
})
