import type { Amenity, AmenityBooking } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { logger } from '../../lib/logger.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { isOps, type AuthUser } from '../../lib/auth.js'
import { writeAudit, type Actor } from '../audit/service.js'
import { amenityRepo as repo } from './repo.js'

export const MAX_DAYS_AHEAD = 30
export const MAX_UPCOMING_PER_FLAT = 4
export const CANCEL_NOTICE_MS = 2 * 3600 * 1000
const IST = '+05:30'

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** A wall-clock time in Pune on a given date, as an instant. */
export const istInstant = (date: string, time: string) => new Date(`${date}T${time}:00${IST}`)
const istDateOf = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)

export const amenityView = (a: Amenity) => ({
  id: a.id, name: a.name, rules: a.rules, feePaise: a.feePaise, feeNote: a.feeNote, slotMinutes: a.slotMinutes, openFrom: a.openFrom, openTo: a.openTo,
  slots: slotStarts(a).map((m) => `${hhmm(m)}-${hhmm(m + a.slotMinutes)}`),
})

function slotStarts(a: Pick<Amenity, 'openFrom' | 'openTo' | 'slotMinutes'>): number[] {
  const out: number[] = []
  for (let m = mins(a.openFrom); m + a.slotMinutes <= mins(a.openTo); m += a.slotMinutes) out.push(m)
  return out
}

export const listAmenities = async () => (await repo.list()).map(amenityView)

export async function availability(amenityId: string, date: string, now = new Date()) {
  const a = await repo.byId(amenityId)
  if (!a) throw notFound('Amenity not found')
  const dayStart = istInstant(date, '00:00')
  const booked = await repo.confirmedOnDay(amenityId, dayStart)
  const taken = new Set(booked.map((b) => b.startsAt.getTime()))
  return {
    amenityId, date,
    slots: slotStarts(a).map((m) => {
      const start = istInstant(date, hhmm(m))
      const past = start.getTime() <= now.getTime()
      return { start: hhmm(m), end: hhmm(m + a.slotMinutes), available: !past && !taken.has(start.getTime()), reason: past ? 'past' : taken.has(start.getTime()) ? 'booked' : null }
    }),
  }
}

const bookingView = (b: AmenityBooking & { amenity: Amenity }) => ({
  id: b.id, amenityId: b.amenityId, amenityName: b.amenity.name, flatId: b.flatId, date: istDateOf(b.startsAt),
  slot: `${hhmm(mins(istInstantTime(b.startsAt)))}-${hhmm(mins(istInstantTime(b.endsAt)))}`, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(),
  feePaise: b.feePaise, status: b.status,
})
const istInstantTime = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(11, 16)

export async function book(user: AuthUser, actor: Actor, b: { amenityId: string; flatId: string; date: string; start: string }, now = new Date()) {
  const a = await repo.byId(b.amenityId)
  if (!a) throw notFound('Amenity not found')
  const starts = slotStarts(a)
  if (!starts.includes(mins(b.start))) throw badRequest(`Slots start at ${starts.map(hhmm).join(', ')}`)
  const startsAt = istInstant(b.date, b.start)
  if (Number.isNaN(startsAt.getTime())) throw badRequest('Invalid date')
  const endsAt = new Date(startsAt.getTime() + a.slotMinutes * 60_000)
  if (startsAt <= now) throw badRequest('That slot has already started')
  if (startsAt.getTime() - now.getTime() > MAX_DAYS_AHEAD * 86400000) throw badRequest(`Bookings open ${MAX_DAYS_AHEAD} days ahead`)

  const dayStart = istInstant(b.date, '00:00')
  const sameDay = await repo.countFlatOnDay(a.id, b.flatId, dayStart)
  if (sameDay >= 1) throw conflict('Your flat already has a booking for this amenity that day')
  const upcoming = await repo.countFlatUpcoming(b.flatId, now)
  if (upcoming >= MAX_UPCOMING_PER_FLAT) throw conflict(`A flat can hold ${MAX_UPCOMING_PER_FLAT} upcoming bookings at a time`)

  try {
    const row = await repo.create({ amenityId: a.id, flatId: b.flatId, startsAt, endsAt, feePaise: a.feePaise, createdBy: user.id })
    if (isOps(user)) await writeAudit(prisma, actor, { action: 'booking.create', entity: 'AmenityBooking', entityId: row.id, after: { flatId: b.flatId, date: b.date, start: b.start }, detail: 'Booked on behalf of a flat' })
    return bookingView(row)
  } catch (e) {
    // The database exclusion constraint is the final word: two people clicking the same slot cannot both win.
    // A deadlock between simultaneous inserts also means someone else got there first; nothing was written.
    const text = String((e as Error).message) + String((e as { code?: string }).code)
    if (/AmenityBooking_no_overlap|exclusion|23P01|deadlock|40P01|P2034/i.test(text)) throw conflict('That slot was just taken')
    logger.error({ code: (e as { code?: string }).code, err: (e as Error).message.slice(0, 300) }, 'unexpected booking error')
    throw e
  }
}

export async function cancel(user: AuthUser, actor: Actor, id: string, now = new Date()) {
  const b = await repo.bookingById(id)
  if (!b || (!isOps(user) && !user.flatIds.includes(b.flatId))) throw notFound('Booking not found')
  if (b.status === 'CANCELLED') return bookingView(b)
  if (!isOps(user) && b.startsAt.getTime() - now.getTime() < CANCEL_NOTICE_MS) throw forbidden('Bookings can be cancelled up to 2 hours before the slot. Call the help desk.')
  const u = await repo.cancel(id)
  if (isOps(user)) await writeAudit(prisma, actor, { action: 'booking.cancel', entity: 'AmenityBooking', entityId: id, before: { status: b.status } })
  return bookingView(u)
}

export async function listBookings(user: AuthUser, q: { flatId?: string; amenityId?: string; date?: string; includeCancelled?: boolean; skip: number; take: number }) {
  const scope = isOps(user) ? {} : { flatId: { in: user.flatIds } }
  const day = q.date ? istInstant(q.date, '00:00') : null
  const where = {
    ...scope, ...(q.flatId ? { flatId: q.flatId } : {}), ...(q.amenityId ? { amenityId: q.amenityId } : {}),
    ...(q.includeCancelled ? {} : { status: 'CONFIRMED' as const }),
    ...(day ? { startsAt: { gte: day, lt: new Date(day.getTime() + 86400000) } } : {}),
  }
  const [rows, total] = await repo.page(where, q.skip, q.take)
  return { total, items: rows.map(bookingView) }
}
