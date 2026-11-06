import { describe, expect, it } from 'vitest'
import { parseAmountPaise, parseDate, parseStatement, splitCsv } from '../src/modules/matching/csv.js'

describe('parseAmountPaise', () => {
  it.each([
    ['7475', 747500], ['7,475.00', 747500], ['1,23,456.50', 12345650], ['Rs. 6,370', 637000], ['₹ 10,660.00', 1066000],
    ['500.5', 50050], ['0.99', 99], ['7475.00 CR', 747500],
  ])('%s', (raw, paise) => expect(parseAmountPaise(raw)).toBe(paise))
  it.each(['', 'abc', '1.2.3', '10.505'])('rejects %j', (raw) => expect(parseAmountPaise(raw)).toBeNull())
})

describe('parseDate', () => {
  it.each([
    ['05/11/2026', '2026-11-05'], ['05-11-2026', '2026-11-05'], ['5.11.26', '2026-11-05'], ['05-Nov-26', '2026-11-05'],
    ['05 Nov 2026', '2026-11-05'], ['5-nov-2026', '2026-11-05'], ['2026-11-05', '2026-11-05'], ['31/12/2026', '2026-12-31'],
  ])('%s', (raw, iso) => expect(parseDate(raw)?.toISOString().slice(0, 10)).toBe(iso))
  it.each(['', '31/02/2026', '13/13/2026', 'yesterday', '05-Foo-26'])('rejects %j', (raw) => expect(parseDate(raw)).toBeNull())
})

describe('splitCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const rows = splitCsv('﻿a,b\r\n\r\n"x, y","say ""hi"""\r\n,,\n1,2')
    expect(rows.map((r) => r.cells)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']])
    expect(rows.map((r) => r.line)).toEqual([1, 3, 5])
  })
})

describe('parseStatement', () => {
  it('reads a headed file with variant header names', () => {
    const csv = 'Txn Date,Particulars,Chq/Ref No,Credit,Debit\n05-Nov-26,"UPI/T07-1203/MAINT, Nov",UTR1,"7,475.00",\n06-Nov-26,Electricity,UTR2,,"1,200.00"\n'
    const r = parseStatement(csv)
    expect(r.rows).toHaveLength(1)
    expect(r.skipped).toBe(1)
    expect(r.rows[0]).toMatchObject({ amountPaise: 747500, reference: 'UTR1', narration: 'UPI/T07-1203/MAINT, Nov' })
  })

  it('reads a headerless file in the default column order', () => {
    const r = parseStatement('2026-11-05,6370,UPI/T12-0408/MAINT,swati.j@ybl,Maintenance\n')
    expect(r.rows[0]).toMatchObject({ amountPaise: 637000, upiId: 'swati.j@ybl', reference: 'UPI/T12-0408/MAINT' })
  })

  it('finds a UPI ID inside the narration', () => {
    const r = parseStatement('Date,Amount,Narration\n05/11/2026,100,"UPI from asha.p@okhdfc maint"\n')
    expect(r.rows[0].upiId).toBe('asha.p@okhdfc')
  })

  it('reports bad rows without failing the file', () => {
    const r = parseStatement('Date,Amount,Reference\n05/11/2026,100,A\nnot a date,100,B\n06/11/2026,abc,C\n07/11/2026,200,D\n')
    expect(r.rows.map((x) => x.reference)).toEqual(['A', 'D'])
    expect(r.errors).toEqual([
      { lineNo: 3, message: expect.stringMatching(/Date/) },
      { lineNo: 4, message: expect.stringMatching(/Amount/) },
    ])
  })

  it('rejects empty and oversized files', () => {
    expect(() => parseStatement('')).toThrow(/empty/)
    expect(() => parseStatement('a,b\n' + 'x'.repeat(1_100_000))).toThrow(/too large/)
  })

  it('rejects too many rows', () => {
    const body = Array.from({ length: 5001 }, () => '05/11/2026,100,R').join('\n')
    expect(() => parseStatement('Date,Amount,Reference\n' + body)).toThrow(/Too many rows/)
  })
})
