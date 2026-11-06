import type { ParsedRow } from './csv.js'

/**
 * Pure matching engine. No database, no clock, no randomness: the same inputs always give the same answer,
 * so every suggestion can be explained and unit tested. It only suggests. Posting is a separate, confirmed step.
 */

export interface FlatInfo {
  flatId: string
  towerNo: number
  /** Flat number within the tower, e.g. "1203" */
  number: string
  residentNames: string[]
  monthlyBillPaise: number
  /** Remaining on the oldest open bill (0 when none) */
  oldestOpenBillPaise: number
  /** Sum remaining across open bills, late fee excluded */
  openBillsPaise: number
  /** Everything owed including late fee. <= 0 means nothing owed. */
  balancePaise: number
  knownUpiIds: string[]
}

export type Confidence = 'EXACT' | 'LIKELY' | 'UNCLEAR'
export type MatchLabel = 'partial' | 'duplicate' | 'two_month' | 'overpay' | 'already_paid' | 'ambiguous' | 'no_identity' | null

export type SignalKind = 'amount_bill' | 'amount_balance' | 'flat_id' | 'flat_id_short' | 'known_upi' | 'payer_name'
export interface Signal {
  kind: SignalKind
  flatId: string
  weight: number
  reason: string
}

export interface MatchResult {
  lineNo: number
  suggestedFlatId: string | null
  confidence: Confidence
  label: MatchLabel
  /** Human readable, in order of importance. */
  reasons: string[]
  signals: Signal[]
  /** Other flats staff may want to look at, for UNCLEAR rows. */
  candidates: string[]
  duplicateOf: string | null
}

export const WEIGHTS = { flat_id: 50, known_upi: 40, amount_bill: 30, amount_balance: 30, payer_name: 20, flat_id_short: 15 } as const
const STRONG: SignalKind[] = ['flat_id', 'known_upi']
const WEAK_IDENTITY: SignalKind[] = ['flat_id_short', 'payer_name']

export const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const SEP = '[\\s\\-_/.:]*'

/** Regexes that recognise a flat in free text. */
export function flatPatterns(f: Pick<FlatInfo, 'towerNo' | 'number'>) {
  const t = String(f.towerNo)
  const t2 = t.padStart(2, '0')
  const num = f.number.replace(/^0+(?=\d)/, '')
  const numPadded = f.number
  const nums = num === numPadded ? num : `(?:${numPadded}|${num})`
  const tower = `0?${t}`
  const lead = '(?<![A-Z0-9])'
  const tail = '(?![0-9])'
  return {
    // T07-1203, T07 1203, T071203, T7/1203, TWR 07 1203, TOWER-7 FLAT 1203
    withPrefix: new RegExp(`${lead}(?:T|TWR|TOWER)${SEP}${tower}${SEP}(?:FLAT${SEP}|NO${SEP})?${nums}${tail}`),
    // 07-1203, 07 1203 (a separator keeps this from matching a bare long number)
    withSeparator: new RegExp(`${lead}${tower}[\\s\\-_/.:]+${nums}${tail}`),
    // 0703: padded tower then the last two digits of the flat. Weak, many flats share it.
    short: new RegExp(`${lead}${t2}${num.slice(-2).padStart(2, '0')}${tail}`),
  }
}

export function flatMentioned(text: string, f: Pick<FlatInfo, 'towerNo' | 'number'>): 'full' | 'short' | null {
  const hay = text.toUpperCase()
  const p = flatPatterns(f)
  if (p.withPrefix.test(hay) || p.withSeparator.test(hay)) return 'full'
  if (p.short.test(hay)) return 'short'
  return null
}

const tokens = (s: string): string[] => s.toUpperCase().replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter(Boolean)

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}
const tokenEq = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && lev(a, b) <= 1)

/**
 * Conservative name match. Needs the surname AND the first name (or its initial) to agree.
 * "N KULKARNI" and "Neeraj Kulkarni" match. "Kulkarni" alone does not, and neither does a first name alone.
 */
export function nameMatches(registered: string, text: string): boolean {
  const reg = tokens(registered)
  const hay = tokens(text)
  if (reg.length < 2 || !hay.length) return false
  const sur = reg[reg.length - 1]
  const first = reg[0]
  if (!hay.some((h) => tokenEq(h, sur))) return false
  return hay.some((h) => tokenEq(h, first) || (h.length === 1 && h === first[0]))
}

export interface EngineInput {
  rows: ParsedRow[]
  flats: FlatInfo[]
  /** Normalised references of payments already posted from earlier statements. */
  postedReferences?: Set<string>
}

const MIN_REF_LEN = 5

export function matchRows(input: EngineInput): MatchResult[] {
  const { rows, flats } = input
  const posted = input.postedReferences ?? new Set<string>()
  const byId = new Map(flats.map((f) => [f.flatId, f]))
  const seenRefs = new Map<string, number>()
  const seenSig = new Map<string, number>()

  return rows.map((row) => {
    const text = `${row.reference} ${row.narration} ${row.payerName ?? ''}`
    const nameText = `${row.payerName ?? ''} ${row.narration}`
    const signals: Signal[] = []
    const add = (kind: SignalKind, f: FlatInfo, reason: string) => signals.push({ kind, flatId: f.flatId, weight: WEIGHTS[kind], reason })

    for (const f of flats) {
      const m = flatMentioned(text, f)
      if (m === 'full') add('flat_id', f, `Reference mentions ${f.flatId}`)
      else if (m === 'short') add('flat_id_short', f, `Reference has a short code that fits ${f.flatId} (weak: many flats share it)`)
      if (row.upiId && f.knownUpiIds.includes(row.upiId)) add('known_upi', f, `UPI ID ${row.upiId} was confirmed for ${f.flatId} before`)
      if (f.residentNames.some((n) => nameMatches(n, nameText))) add('payer_name', f, `Payer name is similar to a resident of ${f.flatId} (weak)`)
      const amt = row.amountPaise
      if (f.oldestOpenBillPaise > 0 && (amt === f.oldestOpenBillPaise || amt === f.openBillsPaise))
        add('amount_bill', f, `Amount equals the open bill of ${f.flatId}`)
      else if (f.balancePaise > 0 && amt === f.balancePaise)
        add('amount_balance', f, `Amount equals the outstanding balance of ${f.flatId} including late fee`)
    }

    // Duplicates: same reference, or same date + amount + payer, seen earlier in this file or already posted.
    const refKey = norm(row.reference)
    const sigKey = `${row.date.toISOString().slice(0, 10)}|${row.amountPaise}|${norm(row.upiId ?? row.payerName ?? '')}`
    let duplicateOf: string | null = null
    if (refKey.length >= MIN_REF_LEN) {
      if (posted.has(refKey)) duplicateOf = 'an earlier posted payment'
      else if (seenRefs.has(refKey)) duplicateOf = `line ${seenRefs.get(refKey)}`
      else seenRefs.set(refKey, row.lineNo)
    }
    const hasPayer = !!(row.upiId || row.payerName)
    if (!duplicateOf && hasPayer) {
      if (seenSig.has(sigKey)) duplicateOf = `line ${seenSig.get(sigKey)}`
      else seenSig.set(sigKey, row.lineNo)
    }

    const forFlat = (id: string, kinds: SignalKind[]) => signals.filter((s) => s.flatId === id && kinds.includes(s.kind))
    const strongIds = [...new Set(signals.filter((s) => STRONG.includes(s.kind)).map((s) => s.flatId))]
    const weakIds = [...new Set(signals.filter((s) => WEAK_IDENTITY.includes(s.kind)).map((s) => s.flatId))]
    const amountIds = [...new Set(signals.filter((s) => s.kind === 'amount_bill' || s.kind === 'amount_balance').map((s) => s.flatId))]

    const res = (r: Partial<MatchResult> & Pick<MatchResult, 'confidence'>): MatchResult => ({
      lineNo: row.lineNo, suggestedFlatId: null, label: null, reasons: [], signals: [], candidates: [], duplicateOf, ...r,
    })
    const dupReason = duplicateOf ? [`Looks like a duplicate of ${duplicateOf}. Duplicates are never posted automatically.`] : []

    // --- identity --------------------------------------------------------------------------
    if (strongIds.length > 1) {
      return res({
        confidence: 'UNCLEAR', label: duplicateOf ? 'duplicate' : 'ambiguous', candidates: strongIds,
        reasons: [`Points to more than one flat (${strongIds.join(', ')}). Pick the right one.`, ...dupReason],
        signals: signals.filter((s) => strongIds.includes(s.flatId)),
      })
    }

    let chosen: FlatInfo | undefined
    let strong = false
    if (strongIds.length === 1) {
      chosen = byId.get(strongIds[0])
      strong = true
    } else if (weakIds.length === 1 && amountIds.includes(weakIds[0])) {
      chosen = byId.get(weakIds[0])
    } else if (weakIds.length > 1 || amountIds.length > 0) {
      const cands = weakIds.length > 1 ? weakIds : amountIds
      return res({
        confidence: 'UNCLEAR', label: duplicateOf ? 'duplicate' : weakIds.length > 1 ? 'ambiguous' : 'no_identity',
        candidates: cands.slice(0, 8),
        reasons: [
          weakIds.length > 1
            ? `Several flats fit the weak hints (${weakIds.slice(0, 5).join(', ')}).`
            : `No flat number or known UPI ID. ${amountIds.length} flat(s) have a bill of this amount.`,
          ...dupReason,
        ],
        signals: [],
      })
    } else {
      return res({
        confidence: 'UNCLEAR', label: duplicateOf ? 'duplicate' : 'no_identity', candidates: weakIds,
        reasons: [
          weakIds.length === 1
            ? `Only a similar payer name points to ${weakIds[0]}, and the amount does not match its bill.`
            : 'No flat number, known UPI ID or matching amount found.',
          ...dupReason,
        ],
        signals: [],
      })
    }
    if (!chosen) return res({ confidence: 'UNCLEAR', reasons: ['Could not resolve the flat.'] })

    // --- amount ----------------------------------------------------------------------------
    const mine = signals.filter((s) => s.flatId === chosen!.flatId)
    const amt = row.amountPaise
    const reasons = mine.map((s) => s.reason)
    const owes = chosen.balancePaise > 0
    const matchesDues = amt === chosen.oldestOpenBillPaise || amt === chosen.openBillsPaise || (owes && amt === chosen.balancePaise)

    // A different flat with an identity hint and the same amount competes with this one.
    const competing = [...new Set([...weakIds, ...amountIds])].filter((id) => id !== chosen!.flatId && weakIds.includes(id) && amountIds.includes(id))

    const base = { suggestedFlatId: chosen.flatId, signals: mine }
    if (duplicateOf) return res({ ...base, confidence: 'LIKELY', label: 'duplicate', reasons: [...dupReason, ...reasons] })
    if (!owes && chosen.openBillsPaise === 0)
      return res({ ...base, confidence: 'LIKELY', label: 'already_paid', reasons: [`${chosen.flatId} has nothing outstanding. Posting would be an advance credit.`, ...reasons] })

    if (matchesDues && strong && competing.length === 0 && forFlat(chosen.flatId, STRONG).length > 0)
      return res({ ...base, confidence: 'EXACT', reasons })
    if (matchesDues && strong)
      return res({ ...base, confidence: 'LIKELY', reasons: [`Another flat (${competing.join(', ')}) also fits. Check before posting.`, ...reasons] })
    if (matchesDues) return res({ ...base, confidence: 'LIKELY', reasons: ['Amount matches but the flat is only weakly identified.', ...reasons] })

    // Amount does not equal the dues. Only meaningful with a strong identity.
    const m = chosen.monthlyBillPaise
    if (m > 0 && amt % m === 0 && amt / m >= 2 && amt / m <= 12)
      return res({ ...base, confidence: 'LIKELY', label: 'two_month', reasons: [`Amount is ${amt / m} times the monthly bill, so it covers ${amt / m} months.`, ...reasons] })
    if (amt < Math.max(chosen.oldestOpenBillPaise, 1) || amt < chosen.balancePaise)
      return res({ ...base, confidence: 'LIKELY', label: 'partial', reasons: ['Less than the amount due: a partial payment. The rest stays outstanding.', ...reasons] })
    return res({ ...base, confidence: 'LIKELY', label: 'overpay', reasons: ['More than the amount due. The extra becomes an advance credit.', ...reasons] })
  })
}

/** Rows that may be posted in bulk: exact, not a duplicate, no special label. */
export const isBulkPostable = (r: Pick<MatchResult, 'confidence' | 'label' | 'duplicateOf'>) =>
  r.confidence === 'EXACT' && r.label === null && r.duplicateOf === null
