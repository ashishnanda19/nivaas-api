/**
 * Computes embeddings for complaints that have none (older complaints and seeded ones), so new complaints can be matched to them by meaning.
 * Only the `embedding` and `embeddingModel` columns are written. Safe to stop and run again; it picks up where it left off.
 *
 *   npm run embeddings:backfill              all complaints without an embedding
 *   npm run embeddings:backfill -- --dry-run just count them
 *   npm run embeddings:backfill -- --limit 50
 *
 * It uses DATABASE_URL, so check which database that is. The host is printed first.
 */
import { prisma } from '../src/lib/db.js'
import { config } from '../src/lib/config.js'
import { defaultEmbeddingClient } from '../src/modules/ai/embed.js'
import { redact } from '../src/modules/ai/redact.js'

const dry = process.argv.includes('--dry-run')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : undefined
const host = new URL(config.DATABASE_URL).host
console.log(`Database: ${host}`)

const todo = await prisma.complaint.findMany({ where: { embeddingModel: null }, select: { id: true, code: true, text: true }, orderBy: { createdAt: 'asc' }, ...(limit ? { take: limit } : {}) })
console.log(`${todo.length} complaint(s) without an embedding`)
if (dry || !todo.length) { await prisma.$disconnect(); process.exit(0) }

const client = defaultEmbeddingClient()
if (!client) { console.error('GEMINI_API_KEY is not set.'); process.exit(1) }
let done = 0, failed = 0
for (const c of todo) {
  try {
    const vector = await client.embed(redact(c.text))
    await prisma.complaint.update({ where: { id: c.id }, data: { embedding: vector, embeddingModel: client.model } })
    done++
  } catch (e) {
    failed++
    console.warn(`${c.code}: ${(e as Error).message}`)
    if (failed >= 5) { console.error('Too many failures, stopping. Run again later.'); break }
  }
  await new Promise((r) => setTimeout(r, 700))
}
console.log(`Embedded ${done}, failed ${failed}.`)
await prisma.$disconnect()
