/**
 * Measures duplicate detection on labelled pairs (eval/duplicates.json): word overlap, which is what linked duplicates before,
 * against embeddings. The threshold is chosen on the "dev" half only and reported on the held-out "test" half.
 *
 *   npm run eval:dupes     needs GEMINI_API_KEY; embeddings are cached in eval/.cache so a rerun costs nothing
 *
 * The pairs were written by the author of the system, so the figures are an optimistic bound.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../src/lib/config.js'
import { cosine, defaultEmbeddingClient } from '../src/modules/ai/embed.js'
import { detectLanguage } from '../src/modules/ai/rules.js'
import { similarity, SIMILARITY_THRESHOLD } from '../src/modules/complaints/service.js'

interface Pair { a: string; b: string; duplicate: boolean }
const pairs: Pair[] = JSON.parse(readFileSync(new URL('./duplicates.json', import.meta.url), 'utf8'))
const client = defaultEmbeddingClient()
if (!client) { console.error('GEMINI_API_KEY is not set.'); process.exit(1) }

const cacheDir = new URL('./.cache/', import.meta.url)
const cacheFile = new URL('./embeddings.json', cacheDir)
mkdirSync(cacheDir, { recursive: true })
const cache: Record<string, number[]> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function vec(text: string) {
  const key = `${client!.model}|${text}`
  if (!cache[key]) { cache[key] = await client!.embed(text); writeFileSync(cacheFile, JSON.stringify(cache)); await sleep(700) }
  return cache[key]
}

const scored: (Pair & { jac: number; cos: number; cross: boolean; split: 'dev' | 'test' })[] = []
const seen: Record<string, number> = {}
for (const p of pairs) {
  const cross = detectLanguage(p.a) !== detectLanguage(p.b)
  // Stratified split: alternate dev and test within each group (duplicate or not, same language or across languages),
  // so both halves hold every kind of pair.
  const group = `${p.duplicate}|${cross}`
  const split = (seen[group] = (seen[group] ?? -1) + 1) % 2 === 0 ? 'dev' : 'test'
  scored.push({ ...p, jac: similarity(p.a, p.b), cos: cosine(await vec(p.a), await vec(p.b)), cross, split })
}

function metrics(rows: typeof scored, key: 'jac' | 'cos', t: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const r of rows) { const pred = r[key] >= t; if (pred && r.duplicate) tp++; else if (pred) fp++; else if (r.duplicate) fn++; else tn++ }
  const p = tp + fp ? tp / (tp + fp) : 1, rc = tp + fn ? tp / (tp + fn) : 0
  return { tp, fp, fn, tn, precision: p, recall: rc, f1: p + rc ? (2 * p * rc) / (p + rc) : 0 }
}
function tune(rows: typeof scored, key: 'jac' | 'cos', lo: number, hi: number) {
  let best = { t: lo, f1: -1 }
  for (let t = lo; t <= hi + 1e-9; t += 0.01) { const m = metrics(rows, key, t); if (m.f1 >= best.f1) best = { t: Math.round(t * 100) / 100, f1: m.f1 } }
  return best.t
}
const dev = scored.filter((r) => r.split === 'dev'), test = scored.filter((r) => r.split === 'test')
const tCos = tune(dev, 'cos', 0.5, 0.97), tJac = tune(dev, 'jac', 0.05, 0.6)
const f = (x: number) => `${(x * 100).toFixed(0)}%`

const lines: string[] = []
const out = (s = '') => { lines.push(s); console.log(s) }
out('# Duplicate detection evaluation')
out()
out(`${pairs.length} labelled pairs (${pairs.filter((p) => p.duplicate).length} same incident worded differently, ${pairs.filter((p) => !p.duplicate).length} same category but a different problem), English, Hindi and Marathi, ${scored.filter((r) => r.cross).length} of them across languages.`)
out(`The threshold is chosen on the ${dev.length} dev pairs and reported on the ${test.length} held-out test pairs. Embedding model: ${config.GEMINI_EMBEDDING_MODEL}. The pairs were written by the author of the system, so the numbers are an optimistic bound.`)
out()
out(`| Method (threshold) | Test precision | Test recall | Test F1 | Wrong links | Missed duplicates |`)
out(`| --- | --- | --- | --- | --- | --- |`)
for (const [label, key, t] of [[`Word overlap, previous setting`, 'jac', SIMILARITY_THRESHOLD], [`Word overlap, tuned on dev`, 'jac', tJac], [`Embeddings, tuned on dev`, 'cos', tCos]] as const) {
  const m = metrics(test, key, t)
  out(`| ${label} (${t}) | ${f(m.precision)} | ${f(m.recall)} | ${f(m.f1)} | ${m.fp} | ${m.fn} |`)
}
out()
const cross = test.filter((r) => r.duplicate && r.cross), same = test.filter((r) => r.duplicate && !r.cross)
out(`Recall on true duplicates in the test half: across languages (${cross.length} pairs) word overlap ${f(metrics(cross, 'jac', SIMILARITY_THRESHOLD).recall)}, embeddings ${f(metrics(cross, 'cos', tCos).recall)}; same language (${same.length} pairs) word overlap ${f(metrics(same, 'jac', SIMILARITY_THRESHOLD).recall)}, embeddings ${f(metrics(same, 'cos', tCos).recall)}.`)
out()
out(`Chosen embedding threshold: ${tCos}. Score ranges on all pairs: duplicates ${Math.min(...scored.filter((r) => r.duplicate).map((r) => r.cos)).toFixed(2)} to ${Math.max(...scored.filter((r) => r.duplicate).map((r) => r.cos)).toFixed(2)}, non-duplicates ${Math.min(...scored.filter((r) => !r.duplicate).map((r) => r.cos)).toFixed(2)} to ${Math.max(...scored.filter((r) => !r.duplicate).map((r) => r.cos)).toFixed(2)}.`)
const wrong = test.filter((r) => (r.cos >= tCos) !== r.duplicate)
if (wrong.length) { out(); out('Embedding mistakes on the test half:'); for (const r of wrong) out(`- ${r.duplicate ? 'missed' : 'wrongly linked'} (${r.cos.toFixed(2)}): "${r.a}" / "${r.b}"`) }
writeFileSync(new URL('./RESULTS-duplicates.md', import.meta.url), lines.join('\n') + '\n')
