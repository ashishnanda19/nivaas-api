import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'
import { istInstant } from '../src/modules/amenities/service.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
let neeraj: string, swati: string, aamir: string, hd: string
const day = (n: number) => new Date(Date.now() + n * 86400000 + 5.5 * 3600e3).toISOString().slice(0, 10)

beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  await prisma.amenity.create({ data: { id: 'club', name: 'Clubhouse', rules: ['No loud music after 10pm'], feePaise: 200000, slotMinutes: 60, openFrom: '06:00', openTo: '22:00' } })
  await prisma.amenity.create({ data: { id: 'court', name: 'Tennis court', rules: [], feePaise: 0, slotMinutes: 30, openFrom: '06:00', openTo: '08:00' } })
  ;[neeraj, swati, aamir, hd] = await Promise.all([PHONES.neeraj, PHONES.swati, PHONES.aamir, PHONES.helpdesk].map((p) => login(app, p)))
})
afterAll(async () => prisma.$disconnect())

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) => app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload })
const book = (token: string, flatId: string, date: string, start: string, amenityId = 'club') => call('POST', '/amenity-bookings', token, { amenityId, flatId, date, start })

describe('booking', () => {
  it('lists amenities with their slots', async () => {
    const r = (await call('GET', '/amenities', neeraj)).json().items
    const club = r.find((a: { id: string }) => a.id === 'club')
    expect(club.slots).toHaveLength(16)
    expect(club.slots[0]).toBe('06:00-07:00')
    expect(r.find((a: { id: string }) => a.id === 'court').slots).toEqual(['06:00-06:30', '06:30-07:00', '07:00-07:30', '07:30-08:00'])
  })

  it('books a slot and shows it as taken in availability', async () => {
    const r = await book(neeraj, 'T07-1203', day(3), '18:00')
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ amenityName: 'Clubhouse', slot: '18:00-19:00', date: day(3), feePaise: 200000, status: 'CONFIRMED' })
    const av = (await call('GET', `/amenities/club/availability?date=${day(3)}`, swati)).json().slots
    expect(av.find((s: { start: string }) => s.start === '18:00')).toMatchObject({ available: false, reason: 'booked' })
    expect(av.find((s: { start: string }) => s.start === '19:00')).toMatchObject({ available: true })
  })

  it('refuses a slot someone else has, sequentially', async () => {
    await book(neeraj, 'T07-1203', day(3), '18:00')
    const r = await book(swati, 'T12-0408', day(3), '18:00')
    expect(r.statusCode).toBe(409)
    expect(r.json().error.message).toMatch(/taken/)
  })

  it('two people clicking the same slot at once: exactly one wins', async () => {
    const results = await Promise.all([book(neeraj, 'T07-1203', day(4), '07:00'), book(swati, 'T12-0408', day(4), '07:00'), book(aamir, 'T21-1601', day(4), '07:00')])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409])
    expect(await prisma.amenityBooking.count()).toBe(1)
  })

  it('the database itself rejects overlapping confirmed bookings', async () => {
    const mk = (s: string, e: string) => prisma.amenityBooking.create({ data: { amenityId: 'club', flatId: 'T07-1203', startsAt: istInstant(day(5), s), endsAt: istInstant(day(5), e), feePaise: 0, createdBy: 'x' } })
    await mk('10:00', '11:00')
    await expect(mk('10:30', '11:30')).rejects.toThrow()
    await expect(mk('09:30', '10:30')).rejects.toThrow()
    await mk('11:00', '12:00') // touching is fine
  })

  it('a cancelled slot can be booked again', async () => {
    const b = (await book(neeraj, 'T07-1203', day(3), '18:00')).json()
    expect((await call('DELETE', `/amenity-bookings/${b.id}`, neeraj)).json().status).toBe('CANCELLED')
    expect((await book(swati, 'T12-0408', day(3), '18:00')).statusCode).toBe(200)
  })

  it('validates the rules', async () => {
    expect((await book(neeraj, 'T07-1203', day(3), '18:30')).statusCode).toBe(400) // not on a slot boundary
    expect((await book(neeraj, 'T07-1203', day(3), '23:00')).statusCode).toBe(400) // closed
    expect((await book(neeraj, 'T07-1203', day(-1), '18:00')).statusCode).toBe(400) // past
    expect((await book(neeraj, 'T07-1203', day(45), '18:00')).statusCode).toBe(400) // too far ahead
    expect((await call('POST', '/amenity-bookings', neeraj, { amenityId: 'club', flatId: 'T07-1203', date: day(3), start: '18:00', fee: 0 })).statusCode).toBe(400)
    expect((await book(neeraj, 'T07-1203', day(3), '18:00', 'nope')).statusCode).toBe(404)
    await book(neeraj, 'T07-1203', day(3), '18:00')
    expect((await book(neeraj, 'T07-1203', day(3), '19:00')).statusCode).toBe(409) // one per amenity per day
  })

  it('a flat holds at most four upcoming bookings', async () => {
    for (let i = 1; i <= 4; i++) expect((await book(neeraj, 'T07-1203', day(i), '18:00')).statusCode).toBe(200)
    expect((await book(neeraj, 'T07-1203', day(6), '18:00')).statusCode).toBe(409)
  })
})

describe('access', () => {
  it("a resident cannot book for, see or cancel another flat's bookings", async () => {
    expect((await book(neeraj, 'T12-0408', day(3), '18:00')).statusCode).toBe(403)
    const b = (await book(swati, 'T12-0408', day(3), '18:00')).json()
    expect((await call('DELETE', `/amenity-bookings/${b.id}`, neeraj)).statusCode).toBe(404)
    expect((await call('GET', '/amenity-bookings', neeraj)).json().total).toBe(0)
    expect((await call('GET', '/amenity-bookings?flatId=T12-0408', neeraj)).statusCode).toBe(403)
    expect((await call('GET', '/amenity-bookings', swati)).json().total).toBe(1)
    expect((await call('GET', '/amenity-bookings', hd)).json().total).toBe(1)
  })

  it('residents cancel up to 2 hours before; the help desk always can, and it is audited', async () => {
    const soon = await prisma.amenityBooking.create({ data: { amenityId: 'club', flatId: 'T07-1203', startsAt: new Date(Date.now() + 3600e3), endsAt: new Date(Date.now() + 7200e3), feePaise: 0, createdBy: 'x' } })
    expect((await call('DELETE', `/amenity-bookings/${soon.id}`, neeraj)).statusCode).toBe(403)
    expect((await call('DELETE', `/amenity-bookings/${soon.id}`, hd)).json().status).toBe('CANCELLED')
    expect(await prisma.auditLog.count({ where: { action: 'booking.cancel' } })).toBe(1)
  })

  it('committee and guards have no booking access', async () => {
    for (const p of [PHONES.committee, PHONES.guard]) expect((await call('GET', '/amenities', await login(app, p))).statusCode).toBe(403)
  })
})

describe('notices', () => {
  it('everyone can read, only the help desk writes, writes are audited', async () => {
    expect((await call('POST', '/notices', neeraj, { title: 'Water cut', body: 'Tomorrow 10 to 2' })).statusCode).toBe(403)
    const n = (await call('POST', '/notices', hd, { title: 'Water cut', body: 'Tomorrow 10 to 2' })).json()
    expect((await call('GET', '/notices', await login(app, PHONES.guard))).json().items[0].title).toBe('Water cut')
    expect((await call('DELETE', `/notices/${n.id}`, hd)).statusCode).toBe(200)
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'notice.' } } })).toBe(2)
  })
})
