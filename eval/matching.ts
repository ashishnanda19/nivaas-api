/**
 * Checks the payment matching engine against what a human accountant would decide for each row of samples/bank-statement.csv.
 * Needs a database seeded with `npm run seed` (the statement was written against the seed data). Nothing is written.
 *
 *   DATABASE_URL=... npm run eval:matching
 *
 * The statement was written by the author of the engine, so this shows the rules behave as designed on a mixed file.
 * It is not a measure of accuracy on real bank statements.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/db.js'
import { parseStatement } from '../src/modules/matching/csv.js'
import { isBulkPostable, matchRows } from '../src/modules/matching/engine.js'
import { loadFlatInfos, postedReferences } from '../src/modules/matching/service.js'

type Outcome = 'post' | 'review' // post: a human would post it as suggested. review: a human would not post it without a decision.
const truth: { flat: string | null; outcome: Outcome; why: string }[] = [
  { flat: 'T12-0408', outcome: 'post', why: 'Swati pays her full bill, flat in the reference' },
  { flat: null, outcome: 'review', why: 'Same reference and amount as the row above: a duplicate' },
  { flat: 'T09-0302', outcome: 'post', why: 'Full bill, flat in the reference' },
  { flat: 'T10-0605', outcome: 'post', why: 'Full bill from a UPI ID that paid before' },
  { flat: 'T21-1601', outcome: 'post', why: 'Partial payment, flat in the reference (balance stays visible)' },
  { flat: 'T05-0702', outcome: 'post', why: 'Two months in advance, flat in the reference' },
  { flat: null, outcome: 'review', why: 'Unknown payer, no flat, amount fits nobody' },
  { flat: null, outcome: 'review', why: 'Cash deposit: the amount fits one bill but nothing says whose it is' },
  { flat: null, outcome: 'review', why: 'T07-1203 is already paid in full: needs a decision, not an automatic post' },
]

const parsed = parseStatement(readFileSync(new URL('../samples/bank-statement.csv', import.meta.url), 'utf8'))
const [flats, posted] = await Promise.all([loadFlatInfos(), postedReferences()])
const results = matchRows({ rows: parsed.rows, flats, postedReferences: posted })

const lines: string[] = []
const out = (s = '') => { lines.push(s); console.log(s) }
out('# Payment matching evaluation')
out()
out(`Sample statement: ${parsed.rows.length} rows, ${parsed.errors.length} parse errors. Each row is compared with what a human accountant would decide.`)
out('The statement was written by the author of the engine, so this shows designed behaviour on a mixed file, not accuracy on real statements.')
out()
out('| # | Narration | Human decision | System | Suggested flat | Auto-postable | Verdict |')
out('| --- | --- | --- | --- | --- | --- | --- |')

let wrongAutoPost = 0
let flatCorrect = 0, flatChecked = 0, safe = 0
results.forEach((m, i) => {
  const t = truth[i]
  const row = parsed.rows[i]
  const bulk = m.confidence === 'EXACT' && isBulkPostable(m)
  // The one error that costs money: the system would post a row on its own that a human would not post, or to the wrong flat.
  const harmful = bulk && (t.outcome === 'review' || m.suggestedFlatId !== t.flat)
  if (harmful) wrongAutoPost++
  if (t.outcome === 'post') {
    flatChecked++
    if (m.suggestedFlatId === t.flat) flatCorrect++
  }
  const heldBack = t.outcome === 'review' ? !bulk : true
  if (heldBack) safe++
  const verdict = harmful ? 'WRONGLY AUTO-POSTABLE' : t.outcome === 'post' ? (m.suggestedFlatId === t.flat ? 'correct flat' : 'flat not suggested, goes to queue') : 'held for a human'
  out(`| ${i + 1} | ${row.narration.slice(0, 38)} ${row.upiId ? '(' + row.upiId + ')' : ''} | ${t.outcome === 'post' ? 'post to ' + t.flat : 'do not post'} | ${m.confidence}${m.label ? ' / ' + m.label : ''} | ${m.suggestedFlatId ?? '-'} | ${bulk ? 'yes' : 'no'} | ${verdict} |`)
})
out()
out('| Measure | Result |')
out('| --- | --- |')
out(`| Rows wrongly auto-postable (target: 0) | ${wrongAutoPost} of ${results.length} |`)
out(`| Rows a human would post where the right flat was suggested | ${flatCorrect} of ${flatChecked} |`)
out(`| Rows a human would hold that the system held | ${truth.filter((t) => t.outcome === 'review').length - results.filter((m, i) => truth[i].outcome === 'review' && m.confidence === 'EXACT' && isBulkPostable(m)).length} of ${truth.filter((t) => t.outcome === 'review').length} |`)
out(`| Rows the system would post in one click (EXACT) | ${results.filter((m) => m.confidence === 'EXACT' && isBulkPostable(m)).length} of ${results.length} |`)
void safe
writeFileSync(new URL('./RESULTS-matching.md', import.meta.url), lines.join('\n') + '\n')
await prisma.$disconnect()
if (wrongAutoPost) process.exit(1)
