import { config } from '../../lib/config.js'

/** Turns a short text into a vector so that texts that mean the same thing land close together, in any of our three languages. */
export interface EmbeddingClient {
  readonly model: string
  embed(text: string): Promise<number[]>
}

export const EMBED_TIMEOUT_MS = 6000
export const EMBED_DIMS = 256

export class EmbedError extends Error {}

type FetchFn = typeof fetch

export class GeminiEmbeddingClient implements EmbeddingClient {
  constructor(private key: string, readonly model: string, private dims = EMBED_DIMS, private doFetch: FetchFn = fetch) {}
  async embed(text: string): Promise<number[]> {
    let res: Response
    try {
      res = await this.doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:embedContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({ model: `models/${this.model}`, content: { parts: [{ text }] }, taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: this.dims }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      })
    } catch (e) {
      throw new EmbedError(`embedding request failed: ${(e as Error).name}`)
    }
    if (!res.ok) throw new EmbedError(`embedding returned ${res.status}`)
    const json = (await res.json()) as { embedding?: { values?: number[] } }
    const v = json.embedding?.values
    if (!Array.isArray(v) || !v.length) throw new EmbedError('embedding returned no vector')
    return v
  }
}

/** Cosine similarity, 1 for the same direction. Vectors of different length, or a zero vector, score 0. */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Available when a Gemini key is set. Without one, duplicates are found by word overlap alone. */
export const defaultEmbeddingClient = (): EmbeddingClient | null =>
  config.GEMINI_API_KEY ? new GeminiEmbeddingClient(config.GEMINI_API_KEY, config.GEMINI_EMBEDDING_MODEL) : null
