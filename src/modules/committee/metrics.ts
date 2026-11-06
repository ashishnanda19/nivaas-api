import { daysBetween } from '../../lib/money.js'

export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const
export type Bucket = (typeof AGEING_BUCKETS)[number]

export const bucketOf = (daysOverdue: number): Bucket =>
  daysOverdue <= 30 ? '0-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+'

export function ageing(rows: { remainingPaise: number; daysOverdue: number }[]) {
  const out = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>
  for (const r of rows) if (r.remainingPaise > 0) out[bucketOf(Math.max(0, r.daysOverdue))] += r.remainingPaise
  return AGEING_BUCKETS.map((bucket) => ({ bucket, amountPaise: out[bucket] }))
}

/**
 * Share of due bills that were fully covered by payments received on or before the due date.
 * Payments are pooled per flat and applied oldest bill first.
 */
export function onTimeRate(
  bills: { flatId: string; dueDate: Date; amountPaise: number }[],
  payments: { flatId: string; paidAt: Date; amountPaise: number }[],
  now: Date,
): { onTime: number; total: number; pct: number } {
  const byFlat = new Map<string, typeof bills>()
  for (const b of bills) (byFlat.get(b.flatId) ?? byFlat.set(b.flatId, []).get(b.flatId)!).push(b)
  const pays = new Map<string, typeof payments>()
  for (const p of payments) (pays.get(p.flatId) ?? pays.set(p.flatId, []).get(p.flatId)!).push(p)
  let onTime = 0
  let total = 0
  for (const [flatId, list] of byFlat) {
    list.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    let cumulative = 0
    for (const b of list) {
      if (b.dueDate.getTime() >= now.getTime()) continue // not due yet, not counted either way
      cumulative += b.amountPaise
      const paidByDue = (pays.get(flatId) ?? []).filter((p) => p.paidAt.getTime() <= b.dueDate.getTime() + 86400000 - 1).reduce((s, p) => s + p.amountPaise, 0)
      total++
      if (paidByDue >= cumulative) onTime++
    }
  }
  return { onTime, total, pct: total ? Math.round((onTime / total) * 1000) / 10 : 0 }
}

export const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0)
export const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3600e3

export const periodsBack = (n: number, now: Date) => {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}
export const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
export { daysBetween }
