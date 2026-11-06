import type { LedgerType } from '@prisma/client'
import type { Db, Tx } from '../../lib/db.js'

export interface AppendInput {
  flatId: string
  type: LedgerType
  /** Signed paise. Charges (bill, late fee) are positive, credits (payment) are negative. */
  amountPaise: number
  /** Unique per flat. Re-posting the same ref is a no-op, which makes every posting idempotent. */
  ref: string
  description: string
  period?: string
}

/** Append one entry. Must be called inside a transaction so the flat row lock holds. */
export async function appendLedger(tx: Tx, p: AppendInput) {
  await tx.$queryRaw`SELECT id FROM "Flat" WHERE id = ${p.flatId} FOR UPDATE`
  const existing = await tx.ledgerEntry.findUnique({ where: { flatId_ref: { flatId: p.flatId, ref: p.ref } } })
  if (existing) return { entry: existing, created: false }
  const last = await tx.ledgerEntry.findFirst({ where: { flatId: p.flatId }, orderBy: { seq: 'desc' } })
  const entry = await tx.ledgerEntry.create({
    data: {
      flatId: p.flatId,
      type: p.type,
      amountPaise: p.amountPaise,
      runningBalancePaise: (last?.runningBalancePaise ?? 0) + p.amountPaise,
      ref: p.ref,
      description: p.description,
      period: p.period,
    },
  })
  return { entry, created: true }
}

export interface Charge {
  ref: string
  type: 'BILL' | 'LATE_FEE'
  period: string | null
  amountPaise: number
  remainingPaise: number
}

export interface Dues {
  balancePaise: number
  charges: Charge[]
  openBills: Charge[]
  /** Credit beyond all charges (advance payment). */
  advancePaise: number
}

/** Pure FIFO allocation of credits to charges. Exported for tests. */
export function allocate(
  entries: { type: LedgerType; amountPaise: number; ref: string; period: string | null }[],
): Dues {
  const charges: Charge[] = []
  let credits = 0
  let balance = 0
  for (const e of entries) {
    balance += e.amountPaise
    if (e.type === 'BILL' || e.type === 'LATE_FEE') {
      if (e.amountPaise > 0) charges.push({ ref: e.ref, type: e.type, period: e.period, amountPaise: e.amountPaise, remainingPaise: e.amountPaise })
      else credits += -e.amountPaise
    } else {
      credits += -e.amountPaise
    }
  }
  let pool = Math.max(credits, 0)
  for (const c of charges) {
    const take = Math.min(pool, c.amountPaise)
    c.remainingPaise = c.amountPaise - take
    pool -= take
  }
  return {
    balancePaise: balance,
    charges,
    openBills: charges.filter((c) => c.type === 'BILL' && c.remainingPaise > 0),
    advancePaise: pool,
  }
}

export async function flatDues(db: Db, flatId: string): Promise<Dues> {
  const rows = await db.ledgerEntry.findMany({
    where: { flatId },
    orderBy: { seq: 'asc' },
    select: { type: true, amountPaise: true, ref: true, period: true },
  })
  return allocate(rows)
}

/** Keep Bill.status in step with the ledger. */
export async function refreshBillStatuses(tx: Tx, flatId: string) {
  const dues = await flatDues(tx, flatId)
  const bills = await tx.bill.findMany({ where: { flatId } })
  for (const b of bills) {
    const c = dues.charges.find((x) => x.ref === `BILL:${b.period}`)
    if (!c) continue
    const status = c.remainingPaise === 0 ? 'PAID' : c.remainingPaise < c.amountPaise ? 'PARTIAL' : 'DUE'
    if (status !== b.status) await tx.bill.update({ where: { id: b.id }, data: { status } })
  }
}

/** Post a received payment: payment entry up to what is owed, any excess as an advance-credit entry. */
export async function postPaymentEntries(
  tx: Tx,
  p: { flatId: string; paymentId: string; amountPaise: number; label: string },
) {
  const dues = await flatDues(tx, p.flatId)
  const owed = Math.max(dues.balancePaise, 0)
  const toDues = Math.min(p.amountPaise, owed)
  const advance = p.amountPaise - toDues
  if (toDues > 0 || advance === 0)
    await appendLedger(tx, {
      flatId: p.flatId, type: 'PAYMENT', amountPaise: -(toDues || p.amountPaise),
      ref: `PAY:${p.paymentId}`, description: p.label,
    })
  if (advance > 0)
    await appendLedger(tx, {
      flatId: p.flatId, type: 'ADJUSTMENT', amountPaise: -advance,
      ref: `ADV:${p.paymentId}`, description: 'Advance credit from overpayment',
    })
  await refreshBillStatuses(tx, p.flatId)
}
