import { badRequest } from '../../lib/errors.js'

export interface ParsedRow {
  lineNo: number
  date: Date
  amountPaise: number
  narration: string
  reference: string
  upiId: string | null
  payerName: string | null
}
export interface ParseError {
  lineNo: number
  message: string
}
export interface ParseResult {
  rows: ParsedRow[]
  errors: ParseError[]
  skipped: number
}

export const MAX_STATEMENT_BYTES = 1_000_000
export const MAX_STATEMENT_ROWS = 5000

/** RFC 4180 style splitter: quotes, escaped quotes, CRLF, BOM. Returns rows with their 1-based line numbers. */
export function splitCsv(text: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^﻿/, '')
  const out: { line: number; cells: string[] }[] = []
  let cells: string[] = []
  let cur = ''
  let quoted = false
  let line = 1
  let startLine = 1
  const endRow = () => {
    cells.push(cur)
    if (cells.some((c) => c.trim() !== '')) out.push({ line: startLine, cells })
    cells = []
    cur = ''
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else {
        if (ch === '\n') line++
        cur += ch
      }
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      endRow()
      line++
      startLine = line
    } else cur += ch
  }
  if (cur !== '' || cells.length) endRow()
  return out
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIASES: Record<string, string[]> = {
  date: ['date', 'txndate', 'transactiondate', 'valuedate', 'postingdate', 'tranxdate'],
  credit: ['credit', 'creditamount', 'deposit', 'deposits', 'cr', 'amountcredited'],
  amount: ['amount', 'amountinr', 'amt', 'transactionamount', 'amountrs'],
  debit: ['debit', 'debitamount', 'withdrawal', 'withdrawals', 'dr'],
  narration: ['narration', 'description', 'particulars', 'remarks', 'details', 'transactionremarks'],
  reference: ['reference', 'ref', 'refno', 'referenceno', 'referencenumber', 'utr', 'utrno', 'chequeno', 'txnid', 'transactionid', 'chqrefno'],
  upi: ['upi', 'upiid', 'vpa', 'payerupi', 'payervpa'],
  payer: ['payer', 'payername', 'name', 'from', 'sender', 'remitter', 'remittername'],
}

function mapHeader(cells: string[]): Record<string, number> | null {
  const map: Record<string, number> = {}
  cells.forEach((c, i) => {
    const k = key(c)
    for (const [field, names] of Object.entries(ALIASES)) if (names.includes(k) && !(field in map)) map[field] = i
  })
  return 'date' in map && ('amount' in map || 'credit' in map) ? map : null
}

/** "1,23,456.50", "Rs. 7,475", "7475.00 CR" -> paise. Returns null when it is not a usable amount. */
export function parseAmountPaise(raw: string): number | null {
  const s = raw.replace(/rs\.?|inr|₹|\b(?:cr|dr)\b/gi, '').replace(/[^0-9.]/g, '')
  if (!s || s === '.' || (s.match(/\./g) ?? []).length > 1) return null
  const [whole, frac = ''] = s.split('.')
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null
  const paise = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2))
  return Number.isSafeInteger(paise) && paise < 2_000_000_000 ? paise : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** DD/MM/YYYY, DD-MM-YYYY, DD.MM.YY, DD-MMM-YY, DD MMM YYYY and ISO YYYY-MM-DD. Day first, as Indian banks print it. */
export function parseDate(raw: string): Date | null {
  const s = raw.trim()
  let d: number, m: number, y: number
  let t = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (t) [y, m, d] = [+t[1], +t[2], +t[3]]
  else if ((t = s.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$/))) {
    d = +t[1]
    m = +t[2]
    y = +t[3] < 100 ? 2000 + +t[3] : +t[3]
  } else if ((t = s.match(/^(\d{1,2})[\- /]([A-Za-z]{3,9})[\- /,]*(\d{2}|\d{4})$/))) {
    d = +t[1]
    m = MONTHS.indexOf(t[2].slice(0, 3).toLowerCase()) + 1
    y = +t[3] < 100 ? 2000 + +t[3] : +t[3]
    if (m === 0) return null
  } else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  if (y < 2000 || y > 2100) return null
  return date
}

const UPI_RE = /[a-z0-9._-]{2,}@[a-z]{2,}/i

export function parseStatement(text: string): ParseResult {
  if (Buffer.byteLength(text) > MAX_STATEMENT_BYTES) throw badRequest('File is too large (limit 1 MB)')
  const grid = splitCsv(text)
  if (!grid.length) throw badRequest('The file is empty')
  const header = mapHeader(grid[0].cells)
  const body = header ? grid.slice(1) : grid
  if (body.length > MAX_STATEMENT_ROWS) throw badRequest(`Too many rows (limit ${MAX_STATEMENT_ROWS})`)
  // Without a header: Date, Amount, Reference, UPI ID, Narration.
  const col = header ?? { date: 0, amount: 1, reference: 2, upi: 3, narration: 4 }
  const cell = (cells: string[], f: string) => (f in col ? (cells[col[f]] ?? '').trim() : '')

  const rows: ParsedRow[] = []
  const errors: ParseError[] = []
  let skipped = 0
  for (const { line, cells } of body) {
    const date = parseDate(cell(cells, 'date'))
    if (!date) {
      errors.push({ lineNo: line, message: `Date "${cell(cells, 'date')}" is not recognised` })
      continue
    }
    const hasSplit = 'credit' in col
    const creditRaw = hasSplit ? cell(cells, 'credit') : cell(cells, 'amount')
    const debitRaw = cell(cells, 'debit')
    if (hasSplit && !creditRaw && debitRaw) {
      skipped++ // an outgoing payment, not a receipt
      continue
    }
    const amount = parseAmountPaise(creditRaw)
    if (amount === null) {
      errors.push({ lineNo: line, message: `Amount "${creditRaw}" is not a valid number` })
      continue
    }
    if (amount === 0) {
      skipped++
      continue
    }
    const narration = cell(cells, 'narration')
    const reference = cell(cells, 'reference')
    const upiCol = cell(cells, 'upi').toLowerCase()
    const found = upiCol || (`${reference} ${narration}`.match(UPI_RE)?.[0] ?? '').toLowerCase()
    rows.push({
      lineNo: line, date, amountPaise: amount, narration: narration.slice(0, 300), reference: reference.slice(0, 100),
      upiId: found || null, payerName: cell(cells, 'payer').slice(0, 100) || null,
    })
  }
  return { rows, errors, skipped }
}
