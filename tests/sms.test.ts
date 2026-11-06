import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/lib/config.js'
import { prisma } from '../src/lib/db.js'
import {
  ConsoleMessageProvider, createMessageProvider, GuardedMessageProvider, MemoryMessageProvider, sentMessages, SmsError, toE164, TwilioMessageProvider,
  type MessageProvider,
} from '../src/modules/auth/messages.js'
import { runReminders } from '../src/modules/reminders/service.js'
import { makeApp, PHONES, seedFixture } from './helpers.js'

afterAll(async () => prisma.$disconnect())

const baseEnv = {
  NODE_ENV: 'development', DATABASE_URL: 'postgresql://x@localhost/x', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), PAYMENT_WEBHOOK_SECRET: 'whsec-123456',
}
const twilioEnv = { ...baseEnv, SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'tok-secret', TWILIO_FROM: '+15005550006' }

const fakeFetch = (status = 201, json: unknown = { sid: 'SM1' }) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }))

describe('phone numbers', () => {
  it.each([
    ['9800000001', '+919800000001'], ['+14155550123', '+14155550123'], ['919800000001', '+919800000001'], ['+91 98000 00001', '+919800000001'],
  ])('%s becomes %s', (input, out) => expect(toE164(input)).toBe(out))
})

describe('Twilio provider', () => {
  it('posts the message to Twilio with basic auth and a form body', async () => {
    const f = fakeFetch()
    const p = new TwilioMessageProvider({ accountSid: 'ACtest', authToken: 'tok-secret', from: '+15005550006', fetch: f as unknown as typeof fetch })
    expect(await p.sendSms('9800000001', 'Your Nivaas code is 123456')).toBe('sent')
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json')
    const headers = init!.headers as Record<string, string>
    expect(headers.authorization).toBe(`Basic ${Buffer.from('ACtest:tok-secret').toString('base64')}`)
    const body = init!.body as URLSearchParams
    expect(body.get('To')).toBe('+919800000001')
    expect(body.get('From')).toBe('+15005550006')
    expect(body.get('Body')).toBe('Your Nivaas code is 123456')
  })

  it('uses a messaging service instead of a from number when one is set', async () => {
    const f = fakeFetch()
    await new TwilioMessageProvider({ accountSid: 'ACtest', authToken: 't', messagingServiceSid: 'MG123', fetch: f as unknown as typeof fetch }).sendSms('9800000001', 'hi')
    const body = f.mock.calls[0][1]!.body as URLSearchParams
    expect(body.get('MessagingServiceSid')).toBe('MG123')
    expect(body.has('From')).toBe(false)
  })

  it('turns a refusal into an error with Twilio\'s code, and leaks neither the token, the number nor the text', async () => {
    const f = fakeFetch(400, { code: 21608, message: 'The number +919800000001 is unverified. Trial accounts cannot send to unverified numbers.' })
    const p = new TwilioMessageProvider({ accountSid: 'ACtest', authToken: 'tok-secret', from: '+15005550006', fetch: f as unknown as typeof fetch })
    const err = (await p.sendSms('9800000001', 'secret text').catch((e: unknown) => e)) as SmsError
    expect(err).toBeInstanceOf(SmsError)
    expect(err.code).toBe(21608)
    expect(err.status).toBe(400)
    expect(err.message).toContain('21608')
    expect(err.message).not.toContain('tok-secret')
    expect(err.message).not.toContain('secret text')
  })

  it('reports a timeout or a network failure as an error', async () => {
    const timeout = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) })
    await expect(new TwilioMessageProvider({ accountSid: 'a', authToken: 't', from: 'f', fetch: timeout as unknown as typeof fetch }).sendSms('9800000001', 'x')).rejects.toThrow(/timeout/)
    const down = vi.fn(async () => { throw new TypeError('fetch failed') })
    await expect(new TwilioMessageProvider({ accountSid: 'a', authToken: 't', from: 'f', fetch: down as unknown as typeof fetch }).sendSms('9800000001', 'x')).rejects.toThrow(/failed/)
  })
})

describe('the allow-list guard', () => {
  const inner = () => ({ sendSms: vi.fn(async () => undefined) }) satisfies MessageProvider
  it('sends only to allowed numbers and reports the rest as skipped', async () => {
    const i = inner()
    const g = new GuardedMessageProvider(i, new Set(['9111111111']), false, new Set())
    expect(await g.sendSms('9111111111', 'a')).toBe('sent')
    expect(await g.sendSms('9222222222', 'b')).toBe('skipped')
    expect(i.sendSms).toHaveBeenCalledTimes(1)
  })
  it('never texts a demo account, even when everything else is allowed', async () => {
    const i = inner()
    const g = new GuardedMessageProvider(i, new Set(), true, new Set(['9800000001']))
    expect(await g.sendSms('9800000001', 'a')).toBe('skipped')
    expect(await g.sendSms('9333333333', 'b')).toBe('sent')
    expect(i.sendSms).toHaveBeenCalledTimes(1)
  })
  it('passes a provider failure through so callers can record it', async () => {
    const g = new GuardedMessageProvider({ sendSms: async () => { throw new SmsError('down') } }, new Set(['9111111111']), false, new Set())
    await expect(g.sendSms('9111111111', 'a')).rejects.toThrow('down')
  })
})

describe('choosing and configuring the provider', () => {
  it('is the console provider unless told otherwise', () => {
    expect(createMessageProvider(loadConfig(baseEnv))).toBeInstanceOf(ConsoleMessageProvider)
  })
  it('refuses to start with Twilio and missing credentials', () => {
    expect(() => loadConfig({ ...baseEnv, SMS_PROVIDER: 'twilio', SMS_ALLOWED_PHONES: '9111111111' })).toThrow(/TWILIO_ACCOUNT_SID/)
  })
  it('refuses to start with a real provider and no allow-list', () => {
    expect(() => loadConfig(twilioEnv)).toThrow(/SMS_ALLOWED_PHONES/)
  })
  it('starts with an allow-list, or with SMS_ALLOW_ALL set on purpose', () => {
    expect(createMessageProvider(loadConfig({ ...twilioEnv, SMS_ALLOWED_PHONES: '9111111111, 9222222222' }))).toBeInstanceOf(GuardedMessageProvider)
    expect([...loadConfig({ ...twilioEnv, SMS_ALLOWED_PHONES: '9111111111, 9222222222' }).smsAllowed]).toEqual(['9111111111', '9222222222'])
    expect(() => loadConfig({ ...twilioEnv, SMS_ALLOW_ALL: 'true' })).not.toThrow()
  })
  it('never delivers to a demo account through the real wiring', async () => {
    const f = fakeFetch()
    const cfg = loadConfig({ ...twilioEnv, SMS_ALLOW_ALL: 'true', DEMO_OTP_PHONES: '9800000001' })
    const p = createMessageProvider(cfg, f as unknown as typeof fetch)
    expect(await p.sendSms('9800000001', 'x')).toBe('skipped')
    expect(f).not.toHaveBeenCalled()
    expect(await p.sendSms('9333333333', 'x')).toBe('sent')
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('sign-in when the provider fails', () => {
  beforeEach(async () => {
    await seedFixture()
  })
  it('answers the same for a registered number whose message could not be sent, and for an unknown number', async () => {
    const sendSms = vi.fn(async () => { throw new SmsError('provider down') })
    const { app } = await (async () => {
      const { buildApp } = await import('../src/app.js')
      return { app: await buildApp({ sms: { sendSms } }) }
    })()
    const known = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONES.neeraj } })
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '9555555555' } })
    expect(known.statusCode).toBe(200)
    expect(known.json()).toEqual(unknown.json())
    expect(sendSms).toHaveBeenCalledTimes(1) // only the registered number is texted
  })
})

describe('reminders through a guarded provider', () => {
  beforeEach(async () => {
    await seedFixture()
    sentMessages.length = 0
  })
  it('records numbers that were held back as SKIPPED, not as sent, and sends them once they are allowed', async () => {
    const inner = new MemoryMessageProvider()
    const closed = new GuardedMessageProvider(inner, new Set(), false, new Set())
    const first = await runReminders(closed)
    expect(first).toMatchObject({ sent: 0, held: 2 })
    expect(sentMessages).toHaveLength(0)
    expect((await prisma.reminder.findMany()).every((r) => r.status === 'SKIPPED')).toBe(true)

    const open = new GuardedMessageProvider(inner, new Set([PHONES.swati, PHONES.aamir]), false, new Set())
    const second = await runReminders(open)
    expect(second).toMatchObject({ sent: 2, held: 0 })
    expect(sentMessages.map((m) => m.phone).sort()).toEqual([PHONES.swati, PHONES.aamir].sort())
    expect(await prisma.reminder.count()).toBe(2) // updated in place
    expect((await prisma.reminder.findMany()).every((r) => r.status === 'SENT')).toBe(true)
    expect((await runReminders(open)).sent).toBe(0) // and not again
  })
})
