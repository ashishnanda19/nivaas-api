import { prisma } from '../../lib/db.js'

export const towerPrefix = (n: number) => `T${String(n).padStart(2, '0')}-`
const inTower = (tower?: number) => (tower ? { flatId: { startsWith: towerPrefix(tower) } } : {})
const complaintTower = (tower?: number) => (tower ? { towerNo: tower } : {})

export const committeeRepo = {
  unpaidBills: (tower?: number) =>
    prisma.bill.findMany({ where: { status: { not: 'PAID' }, ...inTower(tower) }, select: { flatId: true, period: true, dueDate: true } }),
  ledgerForFlats: (flatIds: string[]) =>
    prisma.ledgerEntry.findMany({ where: { flatId: { in: flatIds } }, orderBy: [{ flatId: 'asc' }, { seq: 'asc' }], select: { flatId: true, type: true, amountPaise: true, ref: true, period: true } }),

  billedByPeriod: (periods: string[], tower?: number) =>
    prisma.bill.groupBy({ by: ['period'], where: { period: { in: periods }, ...inTower(tower) }, _sum: { amountPaise: true } }),
  collectedByMonth: (from: Date, tower?: number) =>
    prisma.$queryRaw<{ m: string; s: bigint }[]>`SELECT to_char("paidAt", 'YYYY-MM') AS m, SUM("amountPaise") AS s FROM "Payment" WHERE status = 'SUCCESS' AND "paidAt" >= ${from} AND "flatId" LIKE ${tower ? towerPrefix(tower) + '%' : '%'} GROUP BY 1`,
  billsInPeriods: (periods: string[], tower?: number) =>
    prisma.bill.findMany({ where: { period: { in: periods }, ...inTower(tower) }, select: { flatId: true, dueDate: true, amountPaise: true } }),
  successfulPayments: (tower?: number) =>
    prisma.payment.findMany({ where: { status: 'SUCCESS', paidAt: { not: null }, ...inTower(tower) }, select: { flatId: true, paidAt: true, amountPaise: true } }),
  flatsPerTower: () => prisma.flat.groupBy({ by: ['towerNo'], _count: true }),

  complaintsPerWeek: (since: Date, tower?: number) =>
    prisma.$queryRaw<{ w: Date; n: bigint }[]>`SELECT date_trunc('week', "createdAt") AS w, COUNT(*) AS n FROM "Complaint" WHERE "createdAt" >= ${since} AND (${tower ?? 0}::int = 0 OR "towerNo" = ${tower ?? 0}::int) GROUP BY 1 ORDER BY 1`,
  complaintsByCategory: (since: Date, tower?: number) =>
    prisma.complaint.groupBy({ by: ['category'], where: { createdAt: { gte: since }, ...complaintTower(tower) }, _count: true }),
  complaintTimings: (since: Date, tower?: number) =>
    prisma.complaint.findMany({ where: { createdAt: { gte: since }, ...complaintTower(tower) }, select: { createdAt: true, firstResponseAt: true, resolvedAt: true, reopenedCount: true, status: true } }),
  complaintsByStatus: (tower?: number) => prisma.complaint.groupBy({ by: ['status'], where: complaintTower(tower), _count: true }),
  countOverdue: (since: Date, tower?: number) => prisma.complaint.count({ where: { overdueAt: { not: null }, createdAt: { gte: since }, ...complaintTower(tower) } }),
  countEscalated: (since: Date, tower?: number) => prisma.complaint.count({ where: { escalated: true, createdAt: { gte: since }, ...complaintTower(tower) } }),

  billTotals: (period: string) => prisma.bill.aggregate({ where: { period }, _sum: { amountPaise: true }, _count: true }),
  paymentTotals: (start: Date, end: Date) => prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: start, lt: end } }, _sum: { amountPaise: true }, _count: true }),
  complaintsCreated: (start: Date, end: Date) =>
    prisma.complaint.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { createdAt: true, firstResponseAt: true, category: true, escalated: true, reopenedCount: true } }),
  complaintsResolved: (start: Date, end: Date) =>
    prisma.complaint.findMany({ where: { resolvedAt: { gte: start, lt: end } }, select: { createdAt: true, resolvedAt: true } }),
  society: () => prisma.society.findFirstOrThrow(),

  statementGroups: () => prisma.bankStatementRow.groupBy({ by: ['confidence', 'state'], _count: true }),
  avgMinutesToPost: () =>
    prisma.$queryRaw<{ m: number | null }[]>`SELECT AVG(EXTRACT(EPOCH FROM (r."postedAt" - u."createdAt")) / 60)::float AS m FROM "BankStatementRow" r JOIN "BankStatementUpload" u ON u.id = r."uploadId" WHERE r.state = 'POSTED' AND r."postedAt" IS NOT NULL`,
}
