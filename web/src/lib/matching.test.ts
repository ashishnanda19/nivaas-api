import { matchRows, rowsFromCsv } from './matching'
import { parseCsv } from './csv'
import type { FlatForMatch } from './api/types'

const flats: FlatForMatch[] = [
  {
    id: 'T12-0408',
    billed: 6370,
    outstanding: 6370,
    lateFee: 172,
    upiIds: ['swati.joshi@ybl'],
    name: 'Swati',
  },
  { id: 'T21-1601', billed: 10660, outstanding: 5660, lateFee: 59, upiIds: [], name: 'Aamir' },
  { id: 'T07-1203', billed: 7475, outstanding: 0, lateFee: 0, upiIds: ['neeraj.k@okaxis'], name: 'Neeraj' },
]
const row = (o: Partial<{ amount: number; reference: string; upi: string }>) => ({
  id: 'r',
  date: '2026-11-01',
  amount: 0,
  reference: '',
  upi: '',
  narration: '',
  ...o,
})

describe('matchRows', () => {
  it('marks amount + reference as exact', () => {
    const [m] = matchRows([row({ amount: 6370, reference: 'UPI/T12-0408/MAINT' })], flats)
    expect(m.confidence).toBe('exact')
    expect(m.flatId).toBe('T12-0408')
  })
  it('accepts bill plus late fee as an exact amount', () => {
    const [m] = matchRows([row({ amount: 6542, reference: 'NEFT T120408' })], flats)
    expect(m.confidence).toBe('exact')
  })
  it('labels partial payments and never calls them exact', () => {
    const [m] = matchRows([row({ amount: 3000, reference: 'T211601 PART' })], flats)
    expect(m.kind).toBe('partial')
    expect(m.confidence).toBe('likely')
  })
  it('labels one payment covering two months', () => {
    const [m] = matchRows([row({ amount: 12740, reference: 'T12-0408 2 MONTHS' })], flats)
    expect(m.kind).toBe('two_month')
  })
  it('flags the second identical row as a duplicate', () => {
    const r = row({ amount: 6370, reference: 'UPI/T12-0408/MAINT' })
    const [a, b] = matchRows(
      [
        { ...r, id: 'a' },
        { ...r, id: 'b' },
      ],
      flats,
    )
    expect(a.confidence).toBe('exact')
    expect(b.kind).toBe('duplicate')
    expect(b.confidence).toBe('likely')
  })
  it('flags rows whose reference was posted earlier', () => {
    const [m] = matchRows(
      [row({ amount: 6370, reference: 'UPI/T12-0408/MAINT' })],
      flats,
      new Set(['UPIT120408MAINT']),
    )
    expect(m.kind).toBe('duplicate')
  })
  it('sends rows with no flat to unclear', () => {
    const [m] = matchRows([row({ amount: 4321, reference: 'NEFT 88231', upi: 'x@ybl' })], flats)
    expect(m.confidence).toBe('unclear')
    expect(m.flatId).toBeUndefined()
  })
  it('is unclear when reference and UPI point at different flats', () => {
    const [m] = matchRows([row({ amount: 6370, reference: 'T21-1601', upi: 'swati.joshi@ybl' })], flats)
    expect(m.confidence).toBe('unclear')
  })
  it('does not call an already paid flat exact', () => {
    const [m] = matchRows([row({ amount: 7475, reference: 'T07-1203', upi: 'neeraj.k@okaxis' })], flats)
    expect(m.kind).toBe('already_paid')
    expect(m.confidence).toBe('likely')
  })
})

describe('csv', () => {
  it('parses quoted fields and skips the header', () => {
    const rows = rowsFromCsv(
      parseCsv('Date,Amount,Reference,UPI ID,Narration\n2026-11-01,"1,500",REF 1,a@ybl,"Hello, world"\n'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(1500)
    expect(rows[0].narration).toBe('Hello, world')
  })
})
