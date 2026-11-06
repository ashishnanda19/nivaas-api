import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, PNG, seedFixture } from './helpers.js'
import { purgeExpiredPhotos, resetVerifyLimits, VERIFY_LIMIT } from '../src/modules/visitors/service.js'
import { storage } from '../src/lib/storage.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
let guard: string, neeraj: string, swati: string, hd: string
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  resetVerifyLimits()
  ;[guard, neeraj, swati, hd] = await Promise.all([PHONES.guard, PHONES.neeraj, PHONES.swati, PHONES.helpdesk].map((p) => login(app, p)))
})
afterAll(async () => prisma.$disconnect())

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) => app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload })
const entry = (o: object = {}) => ({ gateId: 'G1', flatId: 'T07-1203', name: 'Ramesh Courier', phone: '9876500001', purpose: 'Delivery', ...o })
const photo = `data:image/png;base64,${PNG.toString('base64')}`
const uuid = (n: number) => `client-id-${String(n).padStart(4, '0')}`

describe('gate entries', () => {
  it('guard creates an entry that waits for the resident', async () => {
    const r = await call('POST', '/visitors', guard, entry())
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ status: 'WAITING', flatId: 'T07-1203', source: 'guard', createdOffline: false, created: true })
    expect(r.json().phone).toMatch(/\*{6}/) // the guard sees it masked too
  })

  it('validates the entry, the flat and the gate', async () => {
    expect((await call('POST', '/visitors', guard, entry({ phone: '123' }))).statusCode).toBe(400)
    expect((await call('POST', '/visitors', guard, entry({ extra: 1 }))).statusCode).toBe(400)
    expect((await call('POST', '/visitors', guard, entry({ flatId: 'T99-9999' }))).statusCode).toBe(404)
    expect((await call('POST', '/visitors', guard, entry({ gateId: 'G9' }))).statusCode).toBe(404)
    expect((await call('POST', '/visitors', guard, entry({ photo: 'data:text/html;base64,PHNjcmlwdD4=' }))).statusCode).toBe(400)
    expect((await call('POST', '/visitors', guard, entry({ photo: 'data:image/png;base64,' + Buffer.from('not an image at all, just text').toString('base64') }))).statusCode).toBe(400)
  })

  it('only guards create entries', async () => {
    for (const t of [neeraj, hd]) expect((await call('POST', '/visitors', t, entry())).statusCode).toBe(403)
  })

  it('resident approves, repeats safely, cannot flip the answer', async () => {
    const v = (await call('POST', '/visitors', guard, entry())).json()
    expect((await call('POST', `/visitors/${v.id}/decision`, neeraj, { decision: 'APPROVED' })).json().status).toBe('APPROVED')
    expect((await call('POST', `/visitors/${v.id}/decision`, neeraj, { decision: 'APPROVED' })).statusCode).toBe(200)
    expect((await call('POST', `/visitors/${v.id}/decision`, neeraj, { decision: 'DENIED' })).statusCode).toBe(409)
    expect(await prisma.auditLog.count({ where: { action: 'visitor.decision' } })).toBe(1)
  })

  it('guard cannot decide, and another flat cannot see or decide', async () => {
    const v = (await call('POST', '/visitors', guard, entry())).json()
    expect((await call('POST', `/visitors/${v.id}/decision`, guard, { decision: 'APPROVED' })).statusCode).toBe(403)
    expect((await call('GET', `/visitors/${v.id}`, swati)).statusCode).toBe(404)
    expect((await call('POST', `/visitors/${v.id}/decision`, swati, { decision: 'APPROVED' })).statusCode).toBe(404)
    expect((await call('GET', '/visitors', swati)).json().total).toBe(0)
    expect((await call('GET', '/visitors?flatId=T07-1203', swati)).statusCode).toBe(403)
    expect((await call('GET', '/visitors', neeraj)).json().items[0].phone).toBe('9876500001') // own flat sees the number
  })

  it('gate moves an approved visitor in and out, in order', async () => {
    const v = (await call('POST', '/visitors', guard, entry())).json()
    expect((await call('POST', `/visitors/${v.id}/status`, guard, { status: 'CHECKED_IN' })).statusCode).toBe(409) // not approved yet
    await call('POST', `/visitors/${v.id}/decision`, neeraj, { decision: 'APPROVED' })
    expect((await call('POST', `/visitors/${v.id}/status`, guard, { status: 'CHECKED_OUT' })).statusCode).toBe(409)
    expect((await call('POST', `/visitors/${v.id}/status`, guard, { status: 'CHECKED_IN' })).json().status).toBe('CHECKED_IN')
    expect((await call('POST', `/visitors/${v.id}/status`, guard, { status: 'CHECKED_OUT' })).json().status).toBe('CHECKED_OUT')
  })

  it('a denied visitor cannot be checked in', async () => {
    const v = (await call('POST', '/visitors', guard, entry())).json()
    await call('POST', `/visitors/${v.id}/decision`, neeraj, { decision: 'DENIED' })
    expect((await call('POST', `/visitors/${v.id}/status`, guard, { status: 'CHECKED_IN' })).statusCode).toBe(409)
  })

  it('help desk sees masked numbers; revealing is audited', async () => {
    await call('POST', '/visitors', guard, entry())
    expect((await call('GET', '/visitors', hd)).json().items[0].phone).toMatch(/\*{6}/)
    expect(await prisma.auditLog.count({ where: { action: 'pii.view' } })).toBe(0)
    expect((await call('GET', '/visitors?reveal=true', hd)).json().items[0].phone).toBe('9876500001')
    expect(await prisma.auditLog.count({ where: { action: 'pii.view' } })).toBe(1)
  })

  it('committee has no visitor access', async () => {
    expect((await call('GET', '/visitors', await login(app, PHONES.committee))).statusCode).toBe(403)
  })
})

describe('offline sync', () => {
  const batch = (n: number, extra: object = {}) => Array.from({ length: n }, (_, i) => entry({ clientId: uuid(i), name: `Guest Number ${i}`, createdAt: new Date(Date.now() - (n - i) * 60_000).toISOString(), ...extra }))

  it('stores a batch once, however many times it is sent', async () => {
    const entries = batch(3)
    const first = (await call('POST', '/visitors/sync', guard, { entries })).json()
    expect(first).toMatchObject({ created: 3, duplicates: 0, errors: 0 })
    const again = (await call('POST', '/visitors/sync', guard, { entries })).json()
    expect(again).toMatchObject({ created: 0, duplicates: 3, errors: 0 })
    expect(await prisma.visitor.count()).toBe(3)
    expect(again.results.map((r: { id: string }) => r.id)).toEqual(first.results.map((r: { id: string }) => r.id))
  })

  it('keeps the device time and marks entries as created offline', async () => {
    const t = new Date(Date.now() - 3 * 3600_000).toISOString()
    await call('POST', '/visitors/sync', guard, { entries: [entry({ clientId: uuid(1), createdAt: t })] })
    const v = await prisma.visitor.findFirstOrThrow()
    expect(v.createdAt.toISOString()).toBe(t)
    expect(v.createdOffline).toBe(true)
  })

  it('two simultaneous uploads of the same entry store one', async () => {
    const body = { entries: batch(1) }
    const [a, b] = await Promise.all([call('POST', '/visitors/sync', guard, body), call('POST', '/visitors/sync', guard, body)])
    expect([a.statusCode, b.statusCode]).toEqual([200, 200])
    expect(await prisma.visitor.count()).toBe(1)
  })

  it('a bad entry fails alone and does not block the rest', async () => {
    const entries = [...batch(2), entry({ clientId: uuid(50), flatId: 'T99-0000' }), entry({ clientId: uuid(51), createdAt: new Date(Date.now() - 9 * 86400000).toISOString() }), entry({ clientId: uuid(52), createdAt: new Date(Date.now() + 3600_000).toISOString() })]
    const r = (await call('POST', '/visitors/sync', guard, { entries })).json()
    expect(r).toMatchObject({ created: 2, errors: 3 })
    expect(r.results.filter((x: { result: string }) => x.result === 'error').map((x: { error: string }) => x.error)).toEqual([expect.stringMatching(/not found/), expect.stringMatching(/older than 7 days/), expect.stringMatching(/future/)])
    // fixing and resending only the failed ones works
    expect((await call('POST', '/visitors/sync', guard, { entries: [entry({ clientId: uuid(50) })] })).json().created).toBe(1)
  })

  it('a single entry with a client id is idempotent too', async () => {
    const e = entry({ clientId: uuid(9) })
    expect((await call('POST', '/visitors', guard, e)).json().created).toBe(true)
    expect((await call('POST', '/visitors', guard, e)).json().created).toBe(false)
    expect(await prisma.visitor.count()).toBe(1)
  })

  it('limits batch size and needs a guard', async () => {
    expect((await call('POST', '/visitors/sync', guard, { entries: batch(101) })).statusCode).toBe(400)
    expect((await call('POST', '/visitors/sync', neeraj, { entries: batch(1) })).statusCode).toBe(403)
    expect((await call('POST', '/visitors/sync', guard, { entries: [] })).statusCode).toBe(400)
  })
})

describe('photo retention (DPDP)', () => {
  it('sets a 90 day delete date and serves the photo through a short link', async () => {
    const v = (await call('POST', '/visitors', guard, entry({ photo }))).json()
    expect(v.photoUrl).toMatch(/\?t=/)
    const row = await prisma.visitor.findUniqueOrThrow({ where: { id: v.id } })
    expect(Math.round((row.photoDeleteAfter!.getTime() - row.createdAt.getTime()) / 86400000)).toBe(90)
    const img = await app.inject({ method: 'GET', url: v.photoUrl })
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    expect((await app.inject({ method: 'GET', url: `/api/v1/files/visitors/${v.id}?t=nope` })).statusCode).toBe(403)
  })

  it('the daily job deletes old photos and files, keeps the visit and newer photos', async () => {
    const old = (await call('POST', '/visitors', guard, entry({ photo, clientId: uuid(1), createdAt: new Date(Date.now() - 3600_000).toISOString() }))).json()
    const fresh = (await call('POST', '/visitors', guard, entry({ photo, clientId: uuid(2) }))).json()
    const oldRow = await prisma.visitor.findUniqueOrThrow({ where: { id: old.id } })
    const file = oldRow.photoPath!
    expect(await storage.get(file)).not.toBeNull()
    await prisma.visitor.update({ where: { id: old.id }, data: { photoDeleteAfter: new Date(Date.now() - 1000) } })
    expect(await purgeExpiredPhotos()).toEqual({ deleted: 1 })
    expect(await storage.get(file)).toBeNull()
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: old.id } })).photoPath).toBeNull()
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: fresh.id } })).photoPath).not.toBeNull()
    expect(await prisma.visitor.count()).toBe(2)
    expect(await purgeExpiredPhotos()).toEqual({ deleted: 0 })
    expect(await prisma.auditLog.count({ where: { action: 'retention.visitor_photos_deleted' } })).toBe(1)
    expect((await call('GET', `/visitors/${old.id}`, neeraj)).json().photoUrl).toBeNull()
  })
})

describe('pre-approved guests', () => {
  const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10) // today in India, which is what the API uses
  const make = async (token = neeraj, flatId = 'T07-1203', date = today()) => call('POST', '/pre-approvals', token, { flatId, guestName: 'Aunty Sharma', date })

  it('creates a 6 digit code, stores only its hash', async () => {
    const r = (await make()).json()
    expect(r.code).toMatch(/^\d{6}$/)
    const row = await prisma.preApproval.findFirstOrThrow()
    expect(row.codeHash).not.toContain(r.code)
    expect(JSON.stringify(row)).not.toContain(r.code)
    expect((await call('GET', '/pre-approvals?flatId=T07-1203', neeraj)).json().items[0]).not.toHaveProperty('code')
  })

  it('the guard verifies it once and a visitor entry appears as approved', async () => {
    const { code } = (await make()).json()
    const v = await call('POST', '/pre-approvals/verify', guard, { code, gateId: 'G1' })
    expect(v.statusCode).toBe(200)
    expect(v.json()).toMatchObject({ status: 'APPROVED', source: 'code', flatId: 'T07-1203', name: 'Aunty Sharma' })
    const again = await call('POST', '/pre-approvals/verify', guard, { code, gateId: 'G1' })
    expect(again.statusCode).toBe(404)
    expect(again.json().error.message).toMatch(/already used/)
  })

  it('a code for another day, an unknown code and a past date are refused', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const { code } = (await make(neeraj, 'T07-1203', tomorrow)).json()
    expect((await call('POST', '/pre-approvals/verify', guard, { code, gateId: 'G1' })).json().error.message).toMatch(/different day/)
    expect((await call('POST', '/pre-approvals/verify', guard, { code: '000000', gateId: 'G1' })).statusCode).toBe(404)
    expect((await make(neeraj, 'T07-1203', '2020-01-01')).statusCode).toBe(400)
  })

  it('two guards presenting the same code at once admit one guest', async () => {
    const { code } = (await make()).json()
    const [a, b] = await Promise.all([call('POST', '/pre-approvals/verify', guard, { code, gateId: 'G1' }), call('POST', '/pre-approvals/verify', guard, { code, gateId: 'G2' })])
    expect([a.statusCode, b.statusCode].filter((c) => c === 200)).toHaveLength(1)
    expect([a.statusCode, b.statusCode].filter((c) => c !== 200).every((c) => c === 404 || c === 409)).toBe(true)
    expect(await prisma.visitor.count()).toBe(1)
  })

  it('locks the guard out after repeated wrong codes', async () => {
    for (let i = 0; i < VERIFY_LIMIT; i++) expect((await call('POST', '/pre-approvals/verify', guard, { code: '111111', gateId: 'G1' })).statusCode).toBe(404)
    const { code } = (await make()).json()
    expect((await call('POST', '/pre-approvals/verify', guard, { code, gateId: 'G1' })).statusCode).toBe(429)
  })

  it("a resident cannot create or list another flat's pre-approvals", async () => {
    expect((await make(swati, 'T07-1203')).statusCode).toBe(403)
    expect((await call('GET', '/pre-approvals?flatId=T07-1203', swati)).statusCode).toBe(403)
    expect((await call('POST', '/pre-approvals/verify', neeraj, { code: '123456', gateId: 'G1' })).statusCode).toBe(403)
  })
})

describe('gate flat lookup', () => {
  it('gives the guard flat ids and abbreviated names only', async () => {
    const r = (await call('GET', '/gate/flats', guard)).json()
    expect(r.items).toEqual([
      { id: 'T07-1203', towerNo: 7, residentName: 'Neeraj K.' },
      { id: 'T12-0408', towerNo: 12, residentName: 'Swati J.' },
      { id: 'T21-1601', towerNo: 21, residentName: 'Aamir S.' },
    ])
    expect(JSON.stringify(r)).not.toMatch(/phone|Kulkarni|balance|9000/)
    expect(r.total).toBe(3)
  })
  it('is paginated and closed to residents and committee', async () => {
    expect((await call('GET', '/gate/flats?pageSize=2', guard)).json().items).toHaveLength(2)
    expect((await call('GET', '/gate/flats', neeraj)).statusCode).toBe(403)
    expect((await call('GET', '/gate/flats', await login(app, PHONES.committee))).statusCode).toBe(403)
    expect((await call('GET', '/gate/flats', hd)).statusCode).toBe(200)
  })
})
