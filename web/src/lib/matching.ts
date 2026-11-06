import type { FlatForMatch } from './api/types'

export type Confidence = 'exact' | 'likely' | 'unclear'
export type MatchKind = 'normal' | 'partial' | 'duplicate' | 'two_month' | 'overpay' | 'already_paid'

export interface StatementRow {
  id: string
  date: string
  amount: number
  reference: string
  upi: string
  narration: string
}
export interface Signal {
  label: string
  hit: boolean
}
export interface MatchRow extends StatementRow {
  flatId?: string
  flatName?: string
  confidence: Confidence
  kind: MatchKind
  signals: Signal[]
  /** Plain-language reasons, supplied by the server. */
  reasons?: string[]
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Parse the bank CSV: date, amount, reference, upi, narration (header row optional). */
export function rowsFromCsv(grid: string[][]): StatementRow[] {
  const body = grid.length && /date/i.test(grid[0][0] ?? '') ? grid.slice(1) : grid
  return body
    .map((r, i) => ({
      id: `r${i + 1}`,
      date: (r[0] ?? '').trim(),
      amount: Number((r[1] ?? '').replace(/[^0-9.]/g, '')),
      reference: (r[2] ?? '').trim(),
      upi: (r[3] ?? '').trim().toLowerCase(),
      narration: (r[4] ?? '').trim(),
    }))
    .filter((r) => r.amount > 0)
}

/**
 * Match rows to flats using three signals: amount equals the bill, the reference carries the flat number,
 * and the UPI ID was seen before for that flat. Nothing is posted here: this only proposes.
 */
export function matchRows(
  rows: StatementRow[],
  flats: FlatForMatch[],
  postedRefs: Set<string> = new Set(),
): MatchRow[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const hay = norm(`${row.reference} ${row.narration}`)
    const byRef = flats.find((f) => hay.includes(norm(f.id)))
    const byUpi = row.upi ? flats.find((f) => f.upiIds.includes(row.upi)) : undefined
    const flat = byRef && byUpi && byRef.id !== byUpi.id ? undefined : (byRef ?? byUpi)

    const key = `${norm(row.reference)}|${row.amount}`
    const duplicate = (!!row.reference && (seen.has(key) || postedRefs.has(norm(row.reference)))) as boolean
    seen.add(key)

    const equalsBill =
      !!flat &&
      (row.amount === flat.outstanding || row.amount === flat.outstanding + flat.lateFee) &&
      flat.outstanding > 0
    const signals: Signal[] = [
      { label: 'Amount equals the bill', hit: equalsBill },
      { label: 'Reference contains the flat number', hit: !!byRef && (!flat || byRef.id === flat.id) },
      { label: 'UPI ID seen before for this flat', hit: !!byUpi && (!flat || byUpi.id === flat.id) },
    ]
    const hits = signals.filter((s) => s.hit).length

    if (!flat) return { ...row, confidence: 'unclear', kind: 'normal', signals }

    let kind: MatchKind = 'normal'
    if (duplicate) kind = 'duplicate'
    else if (flat.outstanding <= 0) kind = 'already_paid'
    else if (row.amount === flat.billed * 2) kind = 'two_month'
    else if (row.amount < flat.outstanding) kind = 'partial'
    else if (!equalsBill) kind = 'overpay'

    const confidence: Confidence = kind === 'normal' && equalsBill && hits >= 2 ? 'exact' : 'likely'
    return { ...row, flatId: flat.id, flatName: flat.name, confidence, kind, signals }
  })
}

export const KIND_LABEL: Record<MatchKind, string> = {
  normal: '',
  partial: 'Partial payment',
  duplicate: 'Duplicate',
  two_month: 'Covers two months',
  overpay: 'More than due',
  already_paid: 'Bill already paid',
}
