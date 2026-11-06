import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_CALLS_PER_HOUR, classifyComplaint, clearClassifyCache, resetAiLimits } from '../src/modules/ai/classify.js'
import { classifyByRules, detectSafety } from '../src/modules/ai/rules.js'
import { redact } from '../src/modules/ai/redact.js'
import { GeminiClient, GroqClient, LlmError, type LlmClient } from '../src/modules/ai/llm.js'

const ok = (obj: object, name = 'gemini'): LlmClient => ({ name, complete: vi.fn(async () => JSON.stringify(obj)) })
const failing = (name: string, kind: 'timeout' | 'rate_limited' | 'http' = 'http'): LlmClient => ({
  name, complete: vi.fn(async () => { throw new LlmError(name, kind, 'boom') }),
})
const raw = (text: string, name = 'gemini'): LlmClient => ({ name, complete: vi.fn(async () => text) })
const cls = (text: string, clients: LlmClient[], userId = 'u1') => classifyComplaint({ text, userId }, clients)

beforeEach(() => {
  clearClassifyCache()
  resetAiLimits()
})

describe('safety words win over the model', () => {
  const lowModel = () => ok({ category: 'HOUSEKEEPING', urgency: 'LOW', reason: 'cosmetic', language: 'en', confidence: 0.99 })
  const cases: [string, string][] = [
    ['en fire', 'There is smoke and fire in the basement parking'],
    ['en gas', 'Strong gas smell near the kitchen shaft on 4th floor'],
    ['en gas leak', 'gas leak in T07 corridor'],
    ['en lift', 'My mother is stuck in the lift between floors 8 and 9'],
    ['en lift2', 'Lift stuck, people trapped inside'],
    ['en shock', 'My son got an electric shock from the switch board'],
    ['en shocks repeatedly', 'I keep getting shocks from the geyser'],
    ['en shock from', 'Shock from the water tap in the kitchen'],
    ['roman shock', 'Switch se shock laga hai, jaldi aao'],
    ['en short', 'Short circuit in the meter room, sparks flying'],
    ['en flood', 'Flooding in the ground floor lobby, pipe burst'],
    ['en collapse', 'Part of the ceiling fell in the stairwell, slab cracked'],
    ['hi fire', 'बेसमेंट में आग लगी है और धुआं फैल रहा है'],
    ['hi gas', 'रसोई के पास गैस की बदबू आ रही है'],
    ['hi lift', 'लिफ्ट में फंस गए हैं, मदद करें'],
    ['hi shock', 'स्विच बोर्ड से बिजली का झटका लगा'],
    ['hi shock loanword', 'बिजली का शॉक लग रहा है स्विच बोर्ड से'],
    ['hi shock child', 'बच्चे को स्विच से शॉक लगा'],
    ['hi flood', 'लॉबी में पानी भर गया है'],
    ['hi roman', 'Gas leak ho raha hai, lift mein fas gaya hu'],
    ['mr fire', 'पार्किंगमध्ये आग लागली आहे'],
    ['mr gas', 'स्वयंपाकघराजवळ गॅसचा वास येतोय'],
    ['mr lift', 'लिफ्टमध्ये अडकले आहे, कृपया मदत करा'],
    ['mr shock', 'स्विचमधून विजेचा धक्का बसला'],
    ['mr shock loanword', 'स्विचमधून शॉक बसला'],
    ['mr shock 2', 'विजेचा शॉक लागला, लगेच या'],
    ['mr collapse', 'जिन्यातील भिंत कोसळली'],
    ['mr flood', 'तळमजल्यावर पाणी साचले, पाईप फुटला'],
  ]
  it.each(cases)('%s', async (_n, text) => {
    const client = lowModel()
    const r = await cls(text, [client])
    expect(r).toMatchObject({ urgency: 'CRITICAL', escalated: true })
    expect(r.escalatedReason).toMatch(/^Safety rule/)
  })

  it('still escalates when every model is down', async () => {
    const r = await cls('gas leak on the 5th floor', [failing('gemini'), failing('groq')])
    expect(r).toMatchObject({ urgency: 'CRITICAL', escalated: true, source: 'rules' })
  })

  it('still escalates when the model returns garbage', async () => {
    const r = await cls('There is a fire in the garbage room', [raw('I cannot help with that')])
    expect(r).toMatchObject({ urgency: 'CRITICAL', escalated: true })
  })

  it('only takes the category from the model, never the urgency', async () => {
    const r = await cls('Lift stuck with people inside', [ok({ category: 'LIFT', urgency: 'LOW', reason: 'x', language: 'en' })])
    expect(r).toMatchObject({ category: 'LIFT', urgency: 'CRITICAL', escalated: true, source: 'gemini' })
  })

  it('checks safety words before calling any model, and the text sent out is redacted', async () => {
    const client = ok({ category: 'OTHER', urgency: 'LOW', reason: 'x', language: 'en' })
    await classifyComplaint({ text: 'Call Neeraj on 9876543210 or n@x.com, T07-1203 smells of gas', userId: 'u', knownNames: ['Neeraj Kulkarni'] }, [client])
    const sent = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
    expect(sent).not.toMatch(/9876543210|n@x\.com|Neeraj|T07-1203/)
    expect(sent).toMatch(/\[phone\]/)
  })

  it('does not escalate ordinary complaints', async () => {
    for (const t of ['The garden lights are not working', 'Water tap dripping in bathroom', 'बगीचे की लाइट बंद है', 'लिफ्ट बंद है', 'Lift not working in tower 14, display shows the wrong floor', 'Fixed asset register needs updating', 'The new maintenance rates are shocking', 'Shock absorber of the main gate is broken', 'शोक सभा की सूचना लगाएं', 'लिफ्ट में झटके लगते हैं'])
      expect(detectSafety(t)).toBeNull()
  })
})

describe('provider fallback', () => {
  const good = { category: 'PLUMBING', urgency: 'NORMAL', reason: 'Tap leaking', language: 'en', confidence: 0.9 }

  it('uses Gemini when it works', async () => {
    const g = ok(good, 'gemini')
    const q = ok({ ...good, category: 'OTHER' }, 'groq')
    const r = await cls('Kitchen tap is dripping', [g, q])
    expect(r).toMatchObject({ category: 'PLUMBING', source: 'gemini', needsReview: false, fellBackFrom: [] })
    expect(q.complete).not.toHaveBeenCalled()
  })

  it.each(['timeout', 'rate_limited', 'http'] as const)('Gemini %s goes to Groq', async (kind) => {
    const r = await cls('Kitchen tap is dripping', [failing('gemini', kind), ok(good, 'groq')])
    expect(r).toMatchObject({ category: 'PLUMBING', source: 'groq', fellBackFrom: ['gemini'] })
  })

  it('both failing goes to the rules classifier and never throws', async () => {
    const r = await cls('The garbage is not being collected, very dirty', [failing('gemini'), failing('groq', 'timeout')])
    expect(r).toMatchObject({ category: 'HOUSEKEEPING', source: 'rules', fellBackFrom: ['gemini', 'groq'] })
  })

  it('no keys at all is rules only', async () => {
    expect((await cls('Lift not working since morning', [])).source).toBe('rules')
  })

  it('invalid JSON becomes OTHER with a review flag, not a guess', async () => {
    const r = await cls('Kitchen tap is dripping', [raw('Sure! It is plumbing.'), ok(good, 'groq')])
    expect(r).toMatchObject({ category: 'OTHER', needsReview: true, source: 'gemini' })
  })

  it('an unknown category becomes OTHER with a review flag', async () => {
    const r = await cls('Kitchen tap is dripping', [ok({ ...good, category: 'PLUMBER' })])
    expect(r).toMatchObject({ category: 'OTHER', needsReview: true })
  })

  it('low confidence becomes OTHER with a review flag', async () => {
    const r = await cls('Kitchen tap is dripping', [ok({ ...good, confidence: 0.2 })])
    expect(r).toMatchObject({ category: 'OTHER', needsReview: true })
  })

  it('accepts fenced JSON', async () => {
    const r = await cls('Kitchen tap is dripping', [raw('```json\n' + JSON.stringify(good) + '\n```')])
    expect(r.category).toBe('PLUMBING')
  })

  it('a model cannot declare CRITICAL without a safety rule hit', async () => {
    const r = await cls('The paint is peeling off the corridor wall', [ok({ ...good, category: 'HOUSEKEEPING', urgency: 'CRITICAL' })])
    expect(r).toMatchObject({ urgency: 'HIGH', escalated: false })
  })

  it('caches identical requests', async () => {
    const g = ok(good)
    await cls('Kitchen tap is dripping', [g], 'a')
    await cls('Kitchen tap is dripping', [g], 'b')
    expect(g.complete).toHaveBeenCalledTimes(1)
  })

  it('rate limits per user and then uses rules instead of failing', async () => {
    const g = ok(good)
    for (let i = 0; i < AI_CALLS_PER_HOUR; i++) await cls(`Tap dripping number ${i}`, [g], 'busy')
    const r = await cls('Tap dripping again and again', [g], 'busy')
    expect(r.source).toBe('rules')
    expect(r.category).toBe('PLUMBING')
    expect(g.complete).toHaveBeenCalledTimes(AI_CALLS_PER_HOUR)
  })
})

describe('rules classifier', () => {
  it.each([
    ['Water tap leaking in the bathroom', 'PLUMBING'],
    ['Lift is not working', 'LIFT'],
    ['Someone parked in my slot, car blocked', 'PARKING'],
    ['Loud music till 2am from flat above', 'NOISE'],
    ['No water supply since morning, tank empty', 'WATER_SUPPLY'],
    ['Garbage not collected, very dirty staircase', 'HOUSEKEEPING'],
    ['Trees need trimming in the garden', 'GARDEN'],
    ['Stranger at the gate without a visitor entry, suspicious', 'SECURITY'],
    ['Corridor light bulb fused', 'ELECTRICAL'],
    ['नल से पानी टपक रहा है', 'PLUMBING'],
    ['कचरा नहीं उठाया गया, गंदगी है', 'HOUSEKEEPING'],
    ['लिफ्ट बंद है', 'LIFT'],
    ['पार्किंगमध्ये गाडी लावली आहे', 'PARKING'],
    ['गोंगाट खूप आहे', 'NOISE'],
    ['Something weird happened', 'OTHER'],
  ])('%s -> %s', (text, cat) => {
    expect(classifyByRules(text).category).toBe(cat)
  })
  it('reads language and urgency hints', () => {
    expect(classifyByRules('कृपया लवकर दुरुस्त करा, नळ गळतोय, पाणी नाही आहे').language).toBe('mr')
    expect(classifyByRules('Tap leaking, need it fixed urgent').urgency).toBe('HIGH')
  })
})

describe('redact', () => {
  it('removes phones, emails, flat codes and known names', () => {
    const t = redact('Ask Swati Joshi (+91 98765 43210, swati@mail.com) at T12-0408 about it', ['Swati Joshi'])
    expect(t).toBe('Ask [name] [name] ([phone], [email]) at [flat] about it')
  })
})

describe('http clients', () => {
  const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  it('Gemini sends the key as a header, not in the URL', async () => {
    const f = vi.fn(async () => resp({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }))
    const out = await new GeminiClient('KEY', 'gemini-x', f as never).complete('sys', 'hi')
    expect(out).toBe('{"a":1}')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toMatch(/KEY/)
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY')
  })
  it('Groq uses the OpenAI-compatible shape', async () => {
    const f = vi.fn(async () => resp({ choices: [{ message: { content: '{"b":2}' } }] }))
    expect(await new GroqClient('K', 'llama', f as never).complete('s', 'u')).toBe('{"b":2}')
  })
  it('maps 429 and timeouts to typed errors', async () => {
    await expect(new GroqClient('K', 'm', (async () => resp({}, 429)) as never).complete('s', 'u')).rejects.toMatchObject({ kind: 'rate_limited' })
    const slow = (async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }) as never
    await expect(new GeminiClient('K', 'm', slow).complete('s', 'u')).rejects.toMatchObject({ kind: 'timeout' })
    await expect(new GeminiClient('K', 'm', (async () => resp({}, 500)) as never).complete('s', 'u')).rejects.toMatchObject({ kind: 'http' })
  })
})
