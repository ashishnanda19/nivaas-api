import { prisma } from '../../lib/db.js'
import type { Db } from '../../lib/db.js'
import { calcLateFee, calcMaintenance, daysBetween, type LateFeeConfig } from '../../lib/money.js'
import { badRequest, notFound } from '../../lib/errors.js'
import { appendLedger, flatDues, refreshBillStatuses } from './ledger.js'
import { writeAudit, type Actor } from '../audit/service.js'
import { billingRepo as repo } from './repo.js'

export async function getSociety(db: Db = prisma) {
  return repo.society(db)
}

export function lateFeeCfg(s: { graceDays: number; lateFeeMode: string; lateFeeFlatPaise: number; lateFeeMonthlyBp: number }): LateFeeConfig {
  return {
    graceDays: s.graceDays,
    mode: s.lateFeeMode === 'FLAT' ? 'FLAT' : 'MONTHLY_INTEREST',
    flatPaise: s.lateFeeFlatPaise,
    monthlyBp: s.lateFeeMonthlyBp,
  }
}

export const periodOk = (p: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p)
export const dueDateFor = (period: string) => new Date(`${period}-10T00:00:00.000Z`)
export const periodLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export async function billRunPreview(period: string) {
  if (!periodOk(period)) throw badRequest('period must be YYYY-MM')
  const soc = await getSociety()
  const flats = await repo.flatsForPreview(period)
  const rows = flats.map((f) => ({
    flatId: f.id,
    name: f.members[0]?.user.name ?? 'Unassigned',
    areaSqft: f.areaSqft,
    amountPaise: calcMaintenance(f.areaSqft, soc.ratePaisePerSqft),
    alreadyBilled: f.bills.length > 0,
  }))
  const pending = rows.filter((r) => !r.alreadyBilled)
  return {
    period,
    ratePaisePerSqft: soc.ratePaisePerSqft,
    flats: pending.length,
    alreadyBilled: rows.length - pending.length,
    totalPaise: pending.reduce((s, r) => s + r.amountPaise, 0),
    rows: pending,
  }
}

/** Publish a bill run. Idempotent per flat and month: running it twice bills nobody twice. */
export async function billRunPublish(period: string, actor: Actor) {
  if (!periodOk(period)) throw badRequest('period must be YYYY-MM')
  const soc = await getSociety()
  const flats = await repo.flatAreas()
  let created = 0
  let total = 0
  for (const f of flats) {
    const amount = calcMaintenance(f.areaSqft, soc.ratePaisePerSqft)
    await prisma.$transaction(async (tx) => {
      if (await tx.bill.findUnique({ where: { flatId_period: { flatId: f.id, period } } })) return
      await tx.bill.create({
        data: { flatId: f.id, period, areaSqft: f.areaSqft, ratePaise: soc.ratePaisePerSqft, amountPaise: amount, dueDate: dueDateFor(period) },
      })
      await appendLedger(tx, {
        flatId: f.id, type: 'BILL', amountPaise: amount, ref: `BILL:${period}`,
        description: `Maintenance ${periodLabel(period)}`, period,
      })
      await refreshBillStatuses(tx, f.id)
      created++
      total += amount
    })
  }
  await writeAudit(prisma, actor, {
    action: 'billing.run.publish', entity: 'BillRun', entityId: period,
    after: { created, totalPaise: total }, detail: `${created} bills for ${period}`,
  })
  return { period, created, skipped: flats.length - created, totalPaise: total }
}

export async function listBillRuns() {
  const rows = await repo.runs()
  return rows.map((r) => ({ period: r.period, label: periodLabel(r.period), bills: r._count, totalPaise: r._sum.amountPaise ?? 0 }))
}

export interface BillView {
  flatId: string
  period: string
  monthLabel: string
  areaSqft: number
  ratePaise: number
  billedPaise: number
  paidPaise: number
  outstandingPaise: number
  lateFeePaise: number
  totalPaise: number
  dueDate: string
  daysOverdue: number
  status: 'paid' | 'due' | 'overdue' | 'partial'
}

async function viewOf(flatId: string, now: Date): Promise<BillView[]> {
  const bills = await repo.billsOfFlat(flatId)
  const dues = await flatDues(prisma, flatId)
  return bills.map((b) => {
    const c = dues.charges.find((x) => x.ref === `BILL:${b.period}`)
    const remaining = c?.remainingPaise ?? 0
    const lateDue = dues.charges.filter((x) => x.type === 'LATE_FEE' && x.ref.startsWith(`LF:${b.id}:`)).reduce((s, x) => s + x.remainingPaise, 0)
    const daysOverdue = remaining > 0 ? Math.max(0, daysBetween(b.dueDate, now)) : 0
    return {
      flatId, period: b.period, monthLabel: periodLabel(b.period), areaSqft: b.areaSqft, ratePaise: b.ratePaise,
      billedPaise: b.amountPaise, paidPaise: b.amountPaise - remaining, outstandingPaise: remaining,
      lateFeePaise: lateDue, totalPaise: remaining + lateDue, dueDate: b.dueDate.toISOString(), daysOverdue,
      status: remaining === 0 && lateDue === 0 ? 'paid' : daysOverdue > 0 ? 'overdue' : remaining < b.amountPaise ? 'partial' : 'due',
    }
  })
}

/** The bill a resident should look at: the oldest one still owing, otherwise the latest. */
export async function currentBill(flatId: string, now = new Date()): Promise<BillView | null> {
  const all = await viewOf(flatId, now)
  return all.find((b) => b.totalPaise > 0) ?? all[all.length - 1] ?? null
}

export async function billHistory(flatId: string, now = new Date()) {
  return (await viewOf(flatId, now)).reverse()
}

export async function ledgerFor(flatId: string, page: { skip: number; take: number }) {
  const [rows, total] = await repo.ledgerPage(flatId, page.skip, page.take)
  return {
    total,
    rows: rows.map((e) => ({
      id: e.id, flatId: e.flatId, date: e.createdAt.toISOString(), type: e.type, description: e.description, ref: e.ref,
      debitPaise: e.amountPaise > 0 ? e.amountPaise : 0, creditPaise: e.amountPaise < 0 ? -e.amountPaise : 0,
      balancePaise: e.runningBalancePaise,
    })),
  }
}

/** Corrections are reversal entries, never edits. */
export async function reverseEntry(flatId: string, entryId: string, reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const e = await tx.ledgerEntry.findFirst({ where: { id: entryId, flatId } })
    if (!e) throw notFound('Ledger entry not found')
    if (e.type === 'REVERSAL') throw badRequest('A reversal cannot be reversed')
    const r = await appendLedger(tx, {
      flatId, type: 'REVERSAL', amountPaise: -e.amountPaise, ref: `REV:${e.id}`,
      description: `Reversal of ${e.description}: ${reason}`,
    })
    if (r.created) {
      await refreshBillStatuses(tx, flatId)
      await writeAudit(tx, actor, { action: 'ledger.reverse', entity: 'LedgerEntry', entityId: e.id, before: { amountPaise: e.amountPaise }, after: { reversedBy: r.entry.id }, detail: reason })
    }
    return { id: r.entry.id, type: r.entry.type, amountPaise: r.entry.amountPaise, balancePaise: r.entry.runningBalancePaise, ref: r.entry.ref }
  })
}

/** Daily job. Accrues late fee per unpaid bill and posts only the new part, so re-runs are no-ops. */
export async function runLateFees(now = new Date()) {
  const soc = await getSociety()
  const cfg = lateFeeCfg(soc)
  const bills = await repo.overdueUnpaid(now)
  let posted = 0
  const stamp = now.toISOString().slice(0, 10).replaceAll('-', '')
  for (const b of bills) {
    await prisma.$transaction(async (tx) => {
      const dues = await flatDues(tx, b.flatId)
      const c = dues.charges.find((x) => x.ref === `BILL:${b.period}`)
      if (!c || c.remainingPaise === 0) return
      const accrued = calcLateFee(c.remainingPaise, daysBetween(b.dueDate, now), cfg)
      const delta = accrued - b.lateFeePostedPaise
      if (delta <= 0) return
      const r = await appendLedger(tx, {
        flatId: b.flatId, type: 'LATE_FEE', amountPaise: delta, ref: `LF:${b.id}:${stamp}`,
        description: `Late fee ${periodLabel(b.period)}`, period: b.period,
      })
      if (r.created) {
        await tx.bill.update({ where: { id: b.id }, data: { lateFeePostedPaise: { increment: delta } } })
        posted++
      }
    })
  }
  return { posted }
}
