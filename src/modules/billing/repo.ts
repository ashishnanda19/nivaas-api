import { prisma } from '../../lib/db.js'
import type { Db } from '../../lib/db.js'

export const billingRepo = {
  society: (db: Db = prisma) => db.society.findFirstOrThrow(),
  /** Every flat with its bill for the period and its first owner or tenant, for the bill-run preview. */
  flatsForPreview: (period: string) =>
    prisma.flat.findMany({
      orderBy: [{ towerNo: 'asc' }, { number: 'asc' }],
      include: { bills: { where: { period }, select: { id: true } }, members: { where: { active: true, relation: { in: ['OWNER', 'TENANT'] } }, include: { user: { select: { name: true } } }, take: 1 } },
    }),
  flatAreas: () => prisma.flat.findMany({ select: { id: true, areaSqft: true } }),
  runs: () => prisma.bill.groupBy({ by: ['period'], _count: true, _sum: { amountPaise: true }, orderBy: { period: 'desc' }, take: 24 }),
  billsOfFlat: (flatId: string) => prisma.bill.findMany({ where: { flatId }, orderBy: { period: 'asc' } }),
  overdueUnpaid: (now: Date) => prisma.bill.findMany({ where: { status: { not: 'PAID' }, dueDate: { lt: now } } }),
  ledgerPage: (flatId: string, skip: number, take: number) =>
    Promise.all([prisma.ledgerEntry.findMany({ where: { flatId }, orderBy: { seq: 'desc' }, skip, take }), prisma.ledgerEntry.count({ where: { flatId } })]),
}
