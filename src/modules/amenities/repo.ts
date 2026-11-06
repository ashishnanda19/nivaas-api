import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

const DAY_MS = 86_400_000
const dayRange = (dayStart: Date) => ({ gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) })

export const amenityRepo = {
  list: () => prisma.amenity.findMany({ orderBy: { name: 'asc' } }),
  byId: (id: string) => prisma.amenity.findUnique({ where: { id } }),

  confirmedOnDay: (amenityId: string, dayStart: Date) =>
    prisma.amenityBooking.findMany({ where: { amenityId, status: 'CONFIRMED', startsAt: dayRange(dayStart) } }),
  countFlatOnDay: (amenityId: string, flatId: string, dayStart: Date) =>
    prisma.amenityBooking.count({ where: { amenityId, flatId, status: 'CONFIRMED', startsAt: dayRange(dayStart) } }),
  countFlatUpcoming: (flatId: string, now: Date) =>
    prisma.amenityBooking.count({ where: { flatId, status: 'CONFIRMED', startsAt: { gt: now } } }),

  create: (data: Prisma.AmenityBookingUncheckedCreateInput) => prisma.amenityBooking.create({ data, include: { amenity: true } }),
  bookingById: (id: string) => prisma.amenityBooking.findUnique({ where: { id }, include: { amenity: true } }),
  cancel: (id: string) => prisma.amenityBooking.update({ where: { id }, data: { status: 'CANCELLED' }, include: { amenity: true } }),

  page: (where: Prisma.AmenityBookingWhereInput, skip: number, take: number) =>
    Promise.all([
      prisma.amenityBooking.findMany({ where, include: { amenity: true }, orderBy: { startsAt: 'asc' }, skip, take }),
      prisma.amenityBooking.count({ where }),
    ]),
}
