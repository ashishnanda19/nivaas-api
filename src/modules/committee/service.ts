import { prisma } from '../../lib/db.js'
import { badRequest } from '../../lib/errors.js'
import { allocate } from '../billing/ledger.js'
import { periodOk } from '../billing/service.js'
import { ageing, avg, daysBetween, hoursBetween, monthLabel, onTimeRate, periodsBack } from './metrics.js'

/** Every unpaid bill with what is still owed on it and how late it is. */
async function openBills(now: Date) {
  const bills = await prisma.bill.findMany({ where: { status: { not: 'PAID' } }, select: { flatId: true, period: true, dueDate: true } })
  const flatIds = [...new Set(bills.map((b) => b.flatId))]
  const ledger = await prisma.ledgerEntry.findMany({ where: { flatId: { in: flatIds } }, orderBy: [{ flatId: 'asc' }, { seq: 'asc' }], select: { flatId: true, type: true, amountPaise: true, ref: true, period: true } })
  const byFlat = new Map<string, typeof ledger>()
  for (const e of ledger) (byFlat.get(e.flatId) ?? byFlat.set(e.flatId, []).get(e.flatId)!).push(e)
  const dues = new Map(flatIds.map((f) => [f, allocate(byFlat.get(f) ?? [])]))
  const rows: { flatId: string; towerNo: number; remainingPaise: number; daysOverdue: number }[] = []
  for (const b of bills) {
    const c = dues.get(b.flatId)!.charges.find((x) => x.ref === `BILL:${b.period}`)
    if (c && c.remainingPaise > 0) rows.push({ flatId: b.flatId, towerNo: Number(b.flatId.slice(1, 3)), remainingPaise: c.remainingPaise, daysOverdue: daysBetween(b.dueDate, now) })
  }
  return rows
}

export async function dashboard(monthsBack = 6, now = new Date()) {
  const periods = periodsBack(monthsBack, now)
  const from = new Date(`${periods[0]}-01T00:00:00Z`)

  const [billed, collectedRows, windowBills, windowPays, open, flatCounts] = await Promise.all([
    prisma.bill.groupBy({ by: ['period'], where: { period: { in: periods } }, _sum: { amountPaise: true } }),
    prisma.$queryRaw<{ m: string; s: bigint }[]>`SELECT to_char("paidAt", 'YYYY-MM') AS m, SUM("amountPaise") AS s FROM "Payment" WHERE status = 'SUCCESS' AND "paidAt" >= ${from} GROUP BY 1`,
    prisma.bill.findMany({ where: { period: { in: periods } }, select: { flatId: true, dueDate: true, amountPaise: true } }),
    prisma.payment.findMany({ where: { status: 'SUCCESS', paidAt: { not: null } }, select: { flatId: true, paidAt: true, amountPaise: true } }),
    openBills(now),
    prisma.flat.groupBy({ by: ['towerNo'], _count: true }),
  ])
  const billedBy = new Map(billed.map((b) => [b.period, b._sum.amountPaise ?? 0]))
  const collectedBy = new Map(collectedRows.map((r) => [r.m, Number(r.s)]))
  const months = periods.map((p) => ({ period: p, label: monthLabel(p), billedPaise: billedBy.get(p) ?? 0, collectedPaise: collectedBy.get(p) ?? 0 }))
  const billedTotal = months.reduce((s, m) => s + m.billedPaise, 0)
  const collectedTotal = months.reduce((s, m) => s + m.collectedPaise, 0)

  const towers = new Map<number, { duesPaise: number; flats: Set<string> }>()
  for (const r of open) {
    const t = towers.get(r.towerNo) ?? { duesPaise: 0, flats: new Set<string>() }
    t.duesPaise += r.remainingPaise
    t.flats.add(r.flatId)
    towers.set(r.towerNo, t)
  }
  const totalFlats = new Map(flatCounts.map((f) => [f.towerNo, f._count]))
  const topTowers = [...towers.entries()]
    .map(([n, t]) => ({ tower: `T${String(n).padStart(2, '0')}`, towerNo: n, duesPaise: t.duesPaise, flatsInArrears: t.flats.size, flats: totalFlats.get(n) ?? 0 }))
    .sort((a, b) => b.duesPaise - a.duesPaise)
    .slice(0, 5)

  return {
    generatedAt: now.toISOString(),
    months,
    billedTotalPaise: billedTotal,
    collectedTotalPaise: collectedTotal,
    collectedPct: billedTotal ? Math.round((collectedTotal / billedTotal) * 1000) / 10 : 0,
    onTime: onTimeRate(windowBills, windowPays.map((p) => ({ flatId: p.flatId, paidAt: p.paidAt!, amountPaise: p.amountPaise })), now),
    ageing: ageing(open),
    outstandingPaise: open.reduce((s, r) => s + r.remainingPaise, 0),
    topDefaultingTowers: topTowers,
    complaints: await complaintMetrics(now),
  }
}

export async function complaintMetrics(now = new Date(), since = new Date(now.getTime() - 90 * 86400000)) {
  const [weekly, byCategory, rows, counts] = await Promise.all([
    prisma.$queryRaw<{ w: Date; n: bigint }[]>`SELECT date_trunc('week', "createdAt") AS w, COUNT(*) AS n FROM "Complaint" WHERE "createdAt" >= ${new Date(now.getTime() - 8 * 7 * 86400000)} GROUP BY 1 ORDER BY 1`,
    prisma.complaint.groupBy({ by: ['category'], where: { createdAt: { gte: since } }, _count: true }),
    prisma.complaint.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, firstResponseAt: true, resolvedAt: true, reopenedCount: true, status: true } }),
    prisma.complaint.groupBy({ by: ['status'], _count: true }),
  ])
  const responded = rows.filter((r) => r.firstResponseAt)
  const resolved = rows.filter((r) => r.resolvedAt)
  const everResolved = rows.filter((r) => r.resolvedAt || r.reopenedCount > 0)
  return {
    windowDays: 90,
    volumeByWeek: weekly.map((w) => ({ weekStart: w.w.toISOString().slice(0, 10), count: Number(w.n) })),
    byCategory: byCategory.map((c) => ({ category: c.category, count: c._count })).sort((a, b) => b.count - a.count),
    avgResponseHours: avg(responded.map((r) => hoursBetween(r.createdAt, r.firstResponseAt!))),
    avgResolutionHours: avg(resolved.map((r) => hoursBetween(r.createdAt, r.resolvedAt!))),
    reopenedPct: everResolved.length ? Math.round((everResolved.filter((r) => r.reopenedCount > 0).length / everResolved.length) * 1000) / 10 : 0,
    open: counts.filter((c) => c.status !== 'RESOLVED').reduce((s, c) => s + c._count, 0),
    overdue: await prisma.complaint.count({ where: { overdueAt: { not: null }, createdAt: { gte: since } } }),
    escalated: await prisma.complaint.count({ where: { escalated: true, createdAt: { gte: since } } }),
  }
}

export async function monthlyReport(period: string, now = new Date()) {
  if (!periodOk(period)) throw badRequest('period must be YYYY-MM')
  const start = new Date(`${period}-01T00:00:00Z`)
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const [billed, paid, open, created, resolved, society] = await Promise.all([
    prisma.bill.aggregate({ where: { period }, _sum: { amountPaise: true }, _count: true }),
    prisma.payment.aggregate({ where: { status: 'SUCCESS', paidAt: { gte: start, lt: end } }, _sum: { amountPaise: true }, _count: true }),
    openBills(now),
    prisma.complaint.findMany({ where: { createdAt: { gte: start, lt: end } }, select: { createdAt: true, firstResponseAt: true, category: true, escalated: true, reopenedCount: true } }),
    prisma.complaint.findMany({ where: { resolvedAt: { gte: start, lt: end } }, select: { createdAt: true, resolvedAt: true } }),
    prisma.society.findFirstOrThrow(),
  ])
  const towers = new Map<number, number>()
  for (const r of open) towers.set(r.towerNo, (towers.get(r.towerNo) ?? 0) + r.remainingPaise)
  return {
    society: society.name, period, generatedAt: now.toISOString(),
    billed: { count: billed._count, totalPaise: billed._sum.amountPaise ?? 0 },
    collected: { count: paid._count, totalPaise: paid._sum.amountPaise ?? 0 },
    outstandingPaise: open.reduce((s, r) => s + r.remainingPaise, 0),
    ageing: ageing(open),
    towers: [...towers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => ({ tower: `T${String(n).padStart(2, '0')}`, duesPaise: v })),
    complaints: {
      raised: created.length, resolved: resolved.length, escalated: created.filter((c) => c.escalated).length,
      avgResponseHours: avg(created.filter((c) => c.firstResponseAt).map((c) => hoursBetween(c.createdAt, c.firstResponseAt!))),
      avgResolutionHours: avg(resolved.map((c) => hoursBetween(c.createdAt, c.resolvedAt!))),
      reopened: created.filter((c) => c.reopenedCount > 0).length,
    },
  }
}
