/**
 * Measures the complaint classifier on a labelled set (eval/complaints.json).
 *
 *   npm run eval:ai          rules classifier and safety rules only, no network
 *   npm run eval:ai:live     also runs the full pipeline with the configured Gemini and Groq keys (about 5 minutes, free-tier pacing)
 *
 * The set was written by the author of the rules, so treat the numbers as an optimistic bound, not an independent benchmark.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { classifyComplaint } from '../src/modules/ai/classify.js'
import { defaultClients } from '../src/modules/ai/llm.js'
import { classifyByRules, detectSafety } from '../src/modules/ai/rules.js'
import { config } from '../src/lib/config.js'

interface Item { kind: 'ordinary' | 'safety' | 'lookalike'; lang: 'en' | 'hi' | 'mr'; text: string; category?: string }
const items: Item[] = JSON.parse(readFileSync(new URL('./complaints.json', import.meta.url), 'utf8'))
const live = process.argv.includes('--live')
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ordinary = items.filter((i) => i.kind === 'ordinary')
const safety = items.filter((i) => i.kind === 'safety')
const look = items.filter((i) => i.kind === 'lookalike')
const langs = ['en', 'hi', 'mr'] as const

// ---- rules only -----------------------------------------------------------------------------------
const rulesRight = ordinary.filter((i) => classifyByRules(i.text).category === i.category)
const rulesWrong = ordinary.filter((i) => classifyByRules(i.text).category !== i.category)
const safetyHits = safety.filter((i) => detectSafety(i.text))
const safetyMiss = safety.filter((i) => !detectSafety(i.text))
const falseEsc = [...look, ...ordinary].filter((i) => detectSafety(i.text))

const lines: string[] = []
const out = (s = '') => { lines.push(s); console.log(s) }
out(`# Complaint classifier evaluation`)
out()
out(`Set: ${items.length} complaints (${ordinary.length} ordinary, ${safety.length} safety, ${look.length} lookalikes that should not escalate). Languages: ${langs.map((l) => `${l} ${items.filter((i) => i.lang === l).length}`).join(', ')}.`)
out(`The set was written by the author of the rules, so the numbers are an optimistic bound.`)
out()
out(`## Rules classifier (no model)`)
out()
out(`| Measure | Result |`)
out(`| --- | --- |`)
out(`| Category accuracy, all ordinary | ${rulesRight.length}/${ordinary.length} (${pct(rulesRight.length, ordinary.length)}) |`)
for (const l of langs) {
  const sub = ordinary.filter((i) => i.lang === l)
  out(`| Category accuracy, ${l} | ${sub.filter((i) => classifyByRules(i.text).category === i.category).length}/${sub.length} |`)
}
out(`| Safety recall (escalated by rule) | ${safetyHits.length}/${safety.length} (${pct(safetyHits.length, safety.length)}) |`)
for (const l of langs) {
  const sub = safety.filter((i) => i.lang === l)
  out(`| Safety recall, ${l} (incl. Roman script under hi) | ${sub.filter((i) => detectSafety(i.text)).length}/${sub.length} |`)
}
out(`| False escalations on ordinary and lookalike | ${falseEsc.length}/${ordinary.length + look.length} |`)
out()
if (rulesWrong.length) { out(`Category misses (rules):`); for (const i of rulesWrong) out(`- [${i.lang}] "${i.text}" expected ${i.category}, got ${classifyByRules(i.text).category}`); out() }
if (safetyMiss.length) { out(`Safety misses:`); for (const i of safetyMiss) out(`- [${i.lang}] "${i.text}"`); out() }
if (falseEsc.length) { out(`False escalations (kept on purpose: a wrong escalation costs a phone call, a missed one can cost a life):`); for (const i of falseEsc) out(`- [${i.lang}] "${i.text}"`); out() }

// ---- full pipeline with the real models -----------------------------------------------------------
if (live) {
  const clients = defaultClients()
  if (!clients.length) { console.error('No GEMINI_API_KEY or GROQ_API_KEY set. Nothing to run live.'); process.exit(1) }
  out(`## Full pipeline with live models (${clients.map((c) => c.name).join(' then ')}, then rules)`)
  out()
  const bySource: Record<string, number> = {}
  let modelRight = 0, needsReview = 0
  const modelWrong: { item: Item; got: string; source: string }[] = []
  for (const [n, item] of ordinary.entries()) {
    const r = await classifyComplaint({ text: item.text, userId: `eval-o-${n}-${Date.now()}` }, clients)
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
    if (r.needsReview) needsReview++
    if (r.category === item.category) modelRight++
    else modelWrong.push({ item, got: r.category, source: r.source })
    await sleep(4500)
  }
  let escalatedOk = 0
  const notEscalated: Item[] = []
  for (const [n, item] of safety.entries()) {
    const r = await classifyComplaint({ text: item.text, userId: `eval-s-${n}-${Date.now()}` }, clients)
    if (r.escalated && r.urgency === 'CRITICAL') escalatedOk++
    else notEscalated.push(item)
    await sleep(4500)
  }
  out(`| Measure | Result |`)
  out(`| --- | --- |`)
  out(`| Category accuracy, all ordinary | ${modelRight}/${ordinary.length} (${pct(modelRight, ordinary.length)}) |`)
  out(`| Answered by | ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')} |`)
  out(`| Flagged "needs review" | ${needsReview} |`)
  out(`| Safety complaints escalated end to end | ${escalatedOk}/${safety.length} (${pct(escalatedOk, safety.length)}) |`)
  out()
  if (modelWrong.length) { out(`Category misses (pipeline):`); for (const w of modelWrong) out(`- [${w.item.lang}] "${w.item.text}" expected ${w.item.category}, got ${w.got} (${w.source})`); out() }
  if (notEscalated.length) { out(`NOT escalated:`); for (const i of notEscalated) out(`- [${i.lang}] "${i.text}"`); out() }
  out(`Models: ${config.GEMINI_MODEL}, ${config.GROQ_MODEL}.`)
}
writeFileSync(new URL(live ? './RESULTS-live.md' : './RESULTS-rules.md', import.meta.url), lines.join('\n') + '\n')
