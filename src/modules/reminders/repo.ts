import type { Prisma, ReminderKind } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const reminderRepo = {
  unpaidBills: () => prisma.bill.findMany({ where: { status: { not: 'PAID' } }, orderBy: [{ flatId: 'asc' }, { period: 'asc' }] }),
  /** Owners and tenants of every flat that has an unpaid bill. Family members are not messaged about dues. */
  payers: (flatIds: string[]) =>
    prisma.flatMember.findMany({
      where: { flatId: { in: flatIds }, active: true, relation: { in: ['OWNER', 'TENANT'] } },
      include: { user: { select: { id: true, name: true, phone: true, language: true } } },
    }),
  find: (billId: string, userId: string, kind: ReminderKind) => prisma.reminder.findUnique({ where: { billId_userId_kind: { billId, userId, kind } } }),
  create: (data: Prisma.ReminderUncheckedCreateInput) => prisma.reminder.create({ data }),
  update: (id: string, data: Prisma.ReminderUncheckedUpdateInput) => prisma.reminder.update({ where: { id }, data }),
  page: (where: Prisma.ReminderWhereInput, skip: number, take: number) =>
    Promise.all([
      prisma.reminder.findMany({ where, orderBy: { sentAt: 'desc' }, skip, take }),
      prisma.reminder.count({ where }),
      prisma.reminder.groupBy({ by: ['kind', 'status'], where, _count: true }),
    ]),
}
