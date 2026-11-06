import { config } from '../../lib/config.js'

export const LLM_TIMEOUT_MS = 6000

export interface LlmClient {
  readonly name: 'gemini' | 'groq' | string
  /** Returns the raw text the model produced. Throws on any transport, quota or timeout problem. */
  complete(system: string, user: string): Promise<string>
}

export class LlmError extends Error {
  constructor(
    public provider: string,
    public kind: 'timeout' | 'rate_limited' | 'http' | 'empty',
    message: string,
  ) {
    super(message)
  }
}

type FetchFn = typeof fetch

async function call(provider: string, doFetch: FetchFn, url: string, init: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await doFetch(url, { ...init, signal: AbortSignal.timeout(LLM_TIMEOUT_MS) })
  } catch (e) {
    const name = (e as Error).name
    throw new LlmError(provider, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'http', `${provider} request failed: ${name}`)
  }
  if (res.status === 429) throw new LlmError(provider, 'rate_limited', `${provider} rate limited`)
  if (!res.ok) throw new LlmError(provider, 'http', `${provider} returned ${res.status}`)
  return res.json()
}

export class GeminiClient implements LlmClient {
  readonly name = 'gemini'
  constructor(private key: string, private model: string, private doFetch: FetchFn = fetch) {}
  async complete(system: string, user: string) {
    const json = (await call('gemini', this.doFetch, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 300 },
      }),
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    if (!text) throw new LlmError('gemini', 'empty', 'gemini returned no text')
    return text
  }
}

export class GroqClient implements LlmClient {
  readonly name = 'groq'
  constructor(private key: string, private model: string, private doFetch: FetchFn = fetch) {}
  async complete(system: string, user: string) {
    const json = (await call('groq', this.doFetch, 'https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    })) as { choices?: { message?: { content?: string } }[] }
    const text = json.choices?.[0]?.message?.content
    if (!text) throw new LlmError('groq', 'empty', 'groq returned no text')
    return text
  }
}

/** Primary Gemini, fallback Groq. Missing keys simply leave a provider out. */
export function defaultClients(): LlmClient[] {
  const out: LlmClient[] = []
  if (config.GEMINI_API_KEY) out.push(new GeminiClient(config.GEMINI_API_KEY, config.GEMINI_MODEL))
  if (config.GROQ_API_KEY) out.push(new GroqClient(config.GROQ_API_KEY, config.GROQ_MODEL))
  return out
}
