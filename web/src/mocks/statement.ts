import { toCsv } from '@/lib/csv'
import type { FlatForMatch } from '@/lib/api/types'

/** A bank statement containing exact, partial, duplicate, unclear and two-month payments, built from live dues. */
export function buildSampleCsv(flats: FlatForMatch[], now = new Date()): string {
  const unpaid = flats.filter((f) => f.outstanding > 0)
  const d = (back: number) => new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10)
  const pick = (i: number) => unpaid[i % Math.max(unpaid.length, 1)]
  const rows: (string | number)[][] = [['Date', 'Amount', 'Reference', 'UPI ID', 'Narration']]
  if (!unpaid.length) return toCsv(rows)
  const a = unpaid.find((f) => f.id === 'T12-0408') ?? pick(0)
  const b = pick(1),
    c = pick(2),
    e = pick(3),
    g = pick(4)
  const part = unpaid.find((f) => f.id === 'T21-1601') ?? pick(5)
  rows.push([d(1), a.outstanding, `UPI/${a.id}/MAINT`, a.upiIds[0] ?? '', 'Maintenance'])
  rows.push([d(1), b.outstanding, `MAINT ${b.id}`, b.upiIds[0] ?? '', 'Society maintenance'])
  rows.push([d(2), c.outstanding + c.lateFee, `NEFT ${c.id.replace('-', '')}`, '', 'Maint with late fee'])
  rows.push([
    d(2),
    Math.round(part.outstanding * 0.55),
    `T${part.id.slice(1).replace('-', '')} PART`,
    part.upiIds[0] ?? '',
    'Part payment',
  ])
  rows.push([d(1), a.outstanding, `UPI/${a.id}/MAINT`, a.upiIds[0] ?? '', 'Maintenance'])
  rows.push([d(3), e.billed * 2, `MAINT ${e.id} 2 MONTHS`, '', 'Two months advance'])
  rows.push([d(3), 4321, 'NEFT 88231', 'unknown.person@ybl', 'Transfer'])
  rows.push([d(4), g.outstanding, '', '', 'Cash deposit'])
  rows.push([d(5), 7475, 'UPI/T07-1203/MAINT', 'neeraj.k@okaxis', 'Maintenance'])
  return toCsv(rows)
}
