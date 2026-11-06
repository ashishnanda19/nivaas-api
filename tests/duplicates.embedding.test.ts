import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { clearClassifyCache, resetAiLimits } from '../src/modules/ai/classify.js'
import { cosine, GeminiEmbeddingClient, type EmbeddingClient } from '../src/modules/ai/embed.js'
import { duplicateMatch, EMBEDDING_THRESHOLD, setEmbeddingClient, setLlmClients } from '../src/modules/complaints/service.js'
import { auth, login, makeApp, PHONES, seedFixture } from './helpers.js'

/**
 * A fake embedder with three "meanings": the lift broken (A), the lift's buttons or mirror (B), and anything else (C).
 * It recognises English, Hindi and Marathi words, so the tests can show meaning linking texts that share no words.
 */
const concept = (t: string): [number, number, number] => {
  if (/button|बटन|mirror/i.test(t)) return [0, 1, 0]
  if (/lift|लिफ्ट|elevator/i.test(t)) return [1, 0, 0]
  return [0, 0, 1]
}
const fake = (calls: string[] = []): EmbeddingClient => ({ model: 'fake-1', embed: async (t) => { calls.push(t); return concept(t) } })

let app: Awaited<ReturnType<typeof makeApp>>['app']
let swati: string, other: string, hd: string
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  setLlmClients([])
  setEmbeddingClient(null)
  clearClassifyCache()
  resetAiLimits()
  await prisma.flat.create({ data: { id: 'T12-0501', towerId: (await prisma.tower.findFirstOrThrow({ where: { number: 12 } })).id, towerNo: 12, number: '0501', areaSqft: 900 } })
  const u = await prisma.user.create({ data: { phone: '9333333333', name: 'Tower Twelve', role: 'RESIDENT', consentAt: new Date() } })
  await prisma.flatMember.create({ data: { userId: u.id, flatId: 'T12-0501', relation: 'OWNER' } })
  ;[swati, other, hd] = await Promise.all([PHONES.swati, '9333333333', PHONES.helpdesk].map((p) => login(app, p)))
})
afterAll(async () => {
  setLlmClients(null)
  setEmbeddingClient(undefined)
  await prisma.$disconnect()
})
const create = (token: string, flatId: string, text: string) =>
  app.inject({ method: 'POST', url: '/api/v1/complaints', headers: auth(token), payload: { flatId, text, category: 'LIFT' } })

describe('the decision', () => {
  const v = (t: string) => ({ text: t, embedding: concept(t), embeddingModel: 'fake-1' })
  it('uses meaning when both sides have an embedding from the same model', () => {
    const m = duplicateMatch(v('Lift is not working'), v('आज सुबह से लिफ्ट बंद है'))
    expect(m).toMatchObject({ method: 'meaning' })
    expect(m!.score).toBeGreaterThanOrEqual(EMBEDDING_THRESHOLD)
  })
  it('lets meaning say no even when the words overlap a lot', () => {
    expect(duplicateMatch(v('Lift in tower 12 not working since morning'), v('Lift buttons in tower 12 not working since morning'))).toBeNull()
  })
  it('falls back to word overlap when either side has no embedding or the models differ', () => {
    const plain = { text: 'Lift not working in tower 12 since morning' }
    expect(duplicateMatch(plain, { text: 'Tower 12 lift not working since morning, very inconvenient' })).toMatchObject({ method: 'words' })
    expect(duplicateMatch(v('Lift not working in tower 12 since morning'), { text: 'Tower 12 lift not working since morning, very inconvenient' })).toMatchObject({ method: 'words' })
    expect(duplicateMatch({ ...v('Lift is not working'), embeddingModel: 'other' }, v('आज सुबह से लिफ्ट बंद है'))).toBeNull() // different models are not compared, and the words do not overlap
  })
  it('measures cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([1, 2], [1])).toBe(0)
    expect(cosine([0, 0], [0, 0])).toBe(0)
  })
})

describe('creating complaints with embeddings', () => {
  it('links the same incident across languages, which word overlap cannot, and records how', async () => {
    setEmbeddingClient(fake())
    const first = (await create(swati, 'T12-0408', 'The lift in our tower has stopped working')).json()
    const second = (await create(other, 'T12-0501', 'आज सुबह से हमारी बिल्डिंग की लिफ्ट बंद है')).json()
    expect(second.clusterId).toBe(first.id)
    const link = await prisma.complaintLink.findFirstOrThrow()
    expect(link).toMatchObject({ method: 'meaning' })
    expect(link.score).toBeGreaterThanOrEqual(EMBEDDING_THRESHOLD)
    expect(second.status).not.toBe('RESOLVED') // linked, never closed
  })

  it('does not link a different problem that shares many words', async () => {
    setEmbeddingClient(fake())
    const first = (await create(swati, 'T12-0408', 'Lift is not working in tower 12 since morning')).json()
    const second = (await create(other, 'T12-0501', 'Lift buttons are not working in tower 12 since morning')).json()
    expect(second.clusterId).toBeNull()
    expect(first.clusterId).toBeNull()
  })

  it('stores the embedding and the model with the complaint, and sends the embedder redacted text', async () => {
    const calls: string[] = []
    setEmbeddingClient(fake(calls))
    await create(swati, 'T12-0408', 'Lift is broken, call me on 9876543210 or n@x.com, this is Swati from T12-0408')
    const row = await prisma.complaint.findFirstOrThrow()
    expect(row.embeddingModel).toBe('fake-1')
    expect(row.embedding).toHaveLength(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toMatch(/9876543210|n@x\.com|T12-0408/)
    expect(calls[0]).toMatch(/\[phone\]/)
  })

  it('still files and links the complaint when the embedder fails, using word overlap', async () => {
    setEmbeddingClient({ model: 'fake-1', embed: async () => { throw new Error('quota exceeded') } })
    const first = await create(swati, 'T12-0408', 'Lift is not working in tower 12 since morning')
    const second = await create(other, 'T12-0501', 'Tower 12 lift not working since morning, very inconvenient')
    expect(first.statusCode).toBe(200)
    expect(second.json().clusterId).toBe(first.json().id)
    expect((await prisma.complaint.findFirstOrThrow()).embedding).toEqual([])
    expect(await prisma.complaintLink.findFirstOrThrow()).toMatchObject({ method: 'words' })
  })

  it('compares a new complaint with an older one that has no embedding by words', async () => {
    const first = (await create(swati, 'T12-0408', 'Lift is not working in tower 12 since morning')).json() // no embedder yet
    setEmbeddingClient(fake())
    const second = (await create(other, 'T12-0501', 'Tower 12 lift not working since morning, very inconvenient')).json()
    expect(second.clusterId).toBe(first.id)
    expect(await prisma.complaintLink.findFirstOrThrow()).toMatchObject({ method: 'words' })
  })

  it('never links a safety complaint, however similar', async () => {
    setEmbeddingClient(fake())
    await create(swati, 'T12-0408', 'The lift in our tower has stopped working')
    const safety = await app.inject({ method: 'POST', url: '/api/v1/complaints', headers: auth(other), payload: { flatId: 'T12-0501', text: 'People are trapped inside the lift, it has stopped working', category: 'LIFT' } })
    expect(safety.json()).toMatchObject({ clusterId: null, escalated: true })
  })

  it('a manual link by the help desk is recorded as manual', async () => {
    const a = (await create(swati, 'T12-0408', 'Lift is not working in tower 12')).json()
    const b = (await app.inject({ method: 'POST', url: '/api/v1/complaints', headers: auth(other), payload: { flatId: 'T12-0501', text: 'Garbage near the entrance', category: 'HOUSEKEEPING' } })).json()
    await app.inject({ method: 'POST', url: `/api/v1/complaints/${b.id}/link`, headers: auth(hd), payload: { parentCode: a.id } })
    expect(await prisma.complaintLink.findFirstOrThrow()).toMatchObject({ method: 'manual', score: null })
  })
})

describe('the Gemini embedding client', () => {
  it('posts to embedContent and returns the vector', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), { status: 200 }))
    const c = new GeminiEmbeddingClient('key-1', 'gemini-embedding-001', 256, f as unknown as typeof fetch)
    expect(await c.embed('hello')).toEqual([0.1, 0.2, 0.3])
    expect(String(f.mock.calls[0][0])).toContain('gemini-embedding-001:embedContent')
    const body = JSON.parse(String(f.mock.calls[0][1]!.body))
    expect(body).toMatchObject({ taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 256 })
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)['x-goog-api-key']).toBe('key-1')
  })
  it('turns an error status or an empty answer into an error', async () => {
    const bad = vi.fn(async () => new Response('{}', { status: 429 }))
    await expect(new GeminiEmbeddingClient('k', 'm', 256, bad as unknown as typeof fetch).embed('x')).rejects.toThrow(/429/)
    const empty = vi.fn(async () => new Response('{}', { status: 200 }))
    await expect(new GeminiEmbeddingClient('k', 'm', 256, empty as unknown as typeof fetch).embed('x')).rejects.toThrow(/no vector/)
  })
})
