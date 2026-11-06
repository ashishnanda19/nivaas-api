import { describe, expect, it } from 'vitest'
import { flatMentioned, isBulkPostable, matchRows, nameMatches, type FlatInfo } from '../src/modules/matching/engine.js'
import type { ParsedRow } from '../src/modules/matching/csv.js'

const flat = (o: Partial<FlatInfo> & { flatId: string }): FlatInfo => {
  const [t, n] = o.flatId.slice(1).split('-')
  return {
    towerNo: +t, number: n, residentNames: [], monthlyBillPaise: 637000, oldestOpenBillPaise: 637000,
    openBillsPaise: 637000, balancePaise: 637000, knownUpiIds: [], ...o,
  }
}
let line = 2
const row = (o: Partial<ParsedRow>): ParsedRow => ({
  lineNo: line++, date: new Date('2026-11-01'), amountPaise: 637000, narration: '', reference: '', upiId: null, payerName: null, ...o,
})
const FLATS = [
  flat({ flatId: 'T07-1203', residentNames: ['Neeraj Kulkarni'], monthlyBillPaise: 747500, oldestOpenBillPaise: 747500, openBillsPaise: 747500, balancePaise: 747500, knownUpiIds: ['neeraj.k@okaxis'] }),
  flat({ flatId: 'T12-0408', residentNames: ['Swati Joshi'], balancePaise: 637000 + 17464, knownUpiIds: ['swati.j@ybl'] }),
  flat({ flatId: 'T21-1601', residentNames: ['Aamir Shaikh'], monthlyBillPaise: 1066000, oldestOpenBillPaise: 566000, openBillsPaise: 566000, balancePaise: 566000 + 9000 }),
  flat({ flatId: 'T12-0409', residentNames: ['Rohit Patil'] }), // same bill as T12-0408
  flat({ flatId: 'T08-0703', residentNames: ['Anita Rao'], oldestOpenBillPaise: 0, openBillsPaise: 0, balancePaise: 0 }),
]
const one = (r: Partial<ParsedRow>, flats = FLATS, posted = new Set<string>()) => matchRows({ rows: [row(r)], flats, postedReferences: posted })[0]

describe('flat identifier formats', () => {
  it.each(['T07-1203', 'T07 1203', 'T071203', 't07/1203', 'T7-1203', 'TWR 07 1203', 'UPI/T07-1203/MAINT', 'tower 7 flat 1203', '07-1203', '7 1203'])('recognises %s', (txt) => {
    expect(flatMentioned(txt, { towerNo: 7, number: '1203' })).toBe('full')
  })
  it('treats 0703 as a weak short code only', () => {
    expect(flatMentioned('MAINT 0703', { towerNo: 7, number: '1203' })).toBe('short')
  })
  it.each(['NEFT 7120300', 'REF 971203', 'T07-12030', '12030'])('does not match inside longer numbers: %s', (txt) => {
    expect(flatMentioned(txt, { towerNo: 7, number: '1203' })).toBeNull()
  })
})

describe('name similarity is conservative', () => {
  it('needs surname and first name or initial', () => {
    expect(nameMatches('Neeraj Kulkarni', 'NEERAJ KULKARNI')).toBe(true)
    expect(nameMatches('Neeraj Kulkarni', 'N Kulkarni')).toBe(true)
    expect(nameMatches('Neeraj Kulkarni', 'Neeraj Kulkarnii')).toBe(true)
    expect(nameMatches('Neeraj Kulkarni', 'Kulkarni')).toBe(false)
    expect(nameMatches('Neeraj Kulkarni', 'Neeraj Sharma')).toBe(false)
    expect(nameMatches('Neeraj Kulkarni', 'Meera Kulkarni')).toBe(false)
  })
})

describe('classification', () => {
  it('EXACT: amount equals the bill and the reference names exactly one flat', () => {
    const r = one({ amountPaise: 637000, reference: 'UPI/T12-0408/MAINT' })
    expect(r).toMatchObject({ confidence: 'EXACT', suggestedFlatId: 'T12-0408', label: null, duplicateOf: null })
    expect(isBulkPostable(r)).toBe(true)
  })

  it('EXACT via a known UPI ID with no flat number in the text', () => {
    const r = one({ amountPaise: 747500, upiId: 'neeraj.k@okaxis' })
    expect(r).toMatchObject({ confidence: 'EXACT', suggestedFlatId: 'T07-1203' })
  })

  it('EXACT when paying the balance including late fee', () => {
    const r = one({ amountPaise: 637000 + 17464, reference: 'MAINT T12-0408' })
    expect(r.confidence).toBe('EXACT')
    expect(r.reasons.join(' ')).toMatch(/late fee/)
  })

  it('UNCLEAR: amount equals many bills but there is no identity signal', () => {
    const r = one({ amountPaise: 637000, narration: 'Cash deposit' })
    expect(r).toMatchObject({ confidence: 'UNCLEAR', suggestedFlatId: null, label: 'no_identity' })
    expect(r.candidates).toEqual(expect.arrayContaining(['T12-0408', 'T12-0409']))
  })

  it('UNCLEAR: nothing at all to go on', () => {
    expect(one({ amountPaise: 4321, reference: 'NEFT 88231', upiId: 'unknown.person@ybl' })).toMatchObject({ confidence: 'UNCLEAR', suggestedFlatId: null })
  })

  it('UNCLEAR: reference and UPI point to different flats', () => {
    const r = one({ amountPaise: 637000, reference: 'T07-1203', upiId: 'swati.j@ybl' })
    expect(r).toMatchObject({ confidence: 'UNCLEAR', label: 'ambiguous', suggestedFlatId: null })
    expect(r.candidates.sort()).toEqual(['T07-1203', 'T12-0408'])
  })

  it('UNCLEAR: a short code shared by several flats', () => {
    const flats = [...FLATS, flat({ flatId: 'T07-0903', residentNames: ['Z Y'] })]
    const r = one({ amountPaise: 123, reference: 'maint 0703' }, flats)
    expect(r.confidence).toBe('UNCLEAR')
  })

  it('LIKELY: partial payment with a strong identity', () => {
    const r = one({ amountPaise: 300000, reference: 'T21-1601 PART' })
    expect(r).toMatchObject({ confidence: 'LIKELY', label: 'partial', suggestedFlatId: 'T21-1601' })
    expect(isBulkPostable(r)).toBe(false)
  })

  it('LIKELY: two months in one payment', () => {
    const r = one({ amountPaise: 747500 * 2, reference: 'MAINT T07-1203 2 MONTHS' })
    expect(r).toMatchObject({ confidence: 'LIKELY', label: 'two_month' })
    expect(r.reasons[0]).toMatch(/2 times the monthly bill/)
  })

  it('LIKELY: more than due is an overpayment', () => {
    expect(one({ amountPaise: 1_000_000, reference: 'T12-0408' })).toMatchObject({ confidence: 'LIKELY', label: 'overpay' })
  })

  it('LIKELY: flat with nothing outstanding', () => {
    expect(one({ amountPaise: 637000, reference: 'T08-0703' })).toMatchObject({ confidence: 'LIKELY', label: 'already_paid' })
  })

  it('LIKELY: right amount, weak identity (payer name) only', () => {
    const r = one({ amountPaise: 747500, payerName: 'N Kulkarni' })
    expect(r).toMatchObject({ confidence: 'LIKELY', suggestedFlatId: 'T07-1203' })
  })

  it('a payer name alone never makes a row exact', () => {
    const r = one({ amountPaise: 100, payerName: 'Neeraj Kulkarni' })
    expect(r.confidence).toBe('UNCLEAR')
  })

  it('explains itself with a reason per signal', () => {
    const r = one({ amountPaise: 637000, reference: 'T12-0408', upiId: 'swati.j@ybl' })
    expect(r.signals.map((s) => s.kind).sort()).toEqual(['amount_bill', 'flat_id', 'known_upi'])
    expect(r.reasons.length).toBe(3)
  })
})

describe('duplicates', () => {
  it('flags the second row with the same reference and never marks it bulk postable', () => {
    const rows = [row({ reference: 'UTR998877', amountPaise: 637000, narration: 'T12-0408' }), row({ reference: 'UTR998877', amountPaise: 637000, narration: 'T12-0408' })]
    const [a, b] = matchRows({ rows, flats: FLATS })
    expect(a.confidence).toBe('EXACT')
    expect(b).toMatchObject({ confidence: 'LIKELY', label: 'duplicate' })
    expect(b.duplicateOf).toBe(`line ${a.lineNo}`)
    expect(isBulkPostable(b)).toBe(false)
  })

  it('flags the same date, amount and payer without a reference', () => {
    const rows = [row({ upiId: 'x@ybl', amountPaise: 500 }), row({ upiId: 'x@ybl', amountPaise: 500 })]
    const [a, b] = matchRows({ rows, flats: FLATS })
    expect(a.duplicateOf).toBeNull()
    expect(b.label).toBe('duplicate')
  })

  it('flags a reference already posted from an earlier statement', () => {
    const r = one({ reference: 'UTR-1234567', narration: 'T12-0408', amountPaise: 637000 }, FLATS, new Set(['UTR1234567']))
    expect(r.label).toBe('duplicate')
    expect(r.duplicateOf).toMatch(/earlier posted/)
  })

  it('does not flag different payments that merely share an amount', () => {
    const rows = [row({ upiId: 'a@ybl', amountPaise: 500 }), row({ upiId: 'b@ybl', amountPaise: 500 })]
    expect(matchRows({ rows, flats: FLATS }).every((r) => r.duplicateOf === null)).toBe(true)
  })
})
