import { config } from '../../lib/config.js'
import { logger } from '../../lib/logger.js'

/** `sent` means the provider accepted it. `skipped` means it was deliberately not sent (not on the allow-list, or a demo account). */
export type SendResult = 'sent' | 'skipped'

export interface MessageProvider {
  sendSms(phone: string, text: string): Promise<SendResult | void>
}

const masked = (phone: string) => `${phone.slice(0, 3)}*****${phone.slice(-2)}`

/** Development provider: logs that a message was sent, never the content of an OTP. Nothing is delivered. */
export class ConsoleMessageProvider implements MessageProvider {
  async sendSms(phone: string) {
    logger.info({ to: masked(phone) }, 'sms sent (console provider)')
  }
}

export const sentMessages: { phone: string; text: string }[] = []

/** Test provider keeps messages in memory so tests can read the OTP. */
export class MemoryMessageProvider implements MessageProvider {
  async sendSms(phone: string, text: string) {
    sentMessages.push({ phone, text })
  }
}

type FetchFn = typeof fetch

export interface TwilioOptions {
  accountSid: string
  authToken: string
  from?: string
  messagingServiceSid?: string
  defaultCountryCode?: string
  fetch?: FetchFn
  timeoutMs?: number
}

export class SmsError extends Error {
  constructor(message: string, public status?: number, public code?: number) {
    super(message)
  }
}

/** A 10 digit Indian mobile number becomes +91..., a number that already has a country code gets a +. */
export function toE164(phone: string, defaultCountryCode = '91'): string {
  const digits = phone.replace(/[^\d]/g, '')
  if (phone.trim().startsWith('+')) return `+${digits}`
  return digits.length === 10 ? `+${defaultCountryCode}${digits}` : `+${digits}`
}

/** Delivers through Twilio's REST API with plain fetch. Errors carry Twilio's code and message, never the token, number or text. */
export class TwilioMessageProvider implements MessageProvider {
  private doFetch: FetchFn
  constructor(private o: TwilioOptions) {
    this.doFetch = o.fetch ?? fetch
  }
  async sendSms(phone: string, text: string): Promise<SendResult> {
    const body = new URLSearchParams({ To: toE164(phone, this.o.defaultCountryCode), Body: text })
    if (this.o.messagingServiceSid) body.set('MessagingServiceSid', this.o.messagingServiceSid)
    else body.set('From', this.o.from ?? '')
    let res: Response
    try {
      res = await this.doFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.o.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.o.accountSid}:${this.o.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 8000),
      })
    } catch (e) {
      const name = (e as Error).name
      throw new SmsError(`twilio request failed: ${name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : name}`)
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { code?: number; message?: string }
      throw new SmsError(`twilio rejected the message (${res.status}${j.code ? `, code ${j.code}` : ''}): ${(j.message ?? '').slice(0, 160)}`, res.status, j.code)
    }
    return 'sent'
  }
}

/**
 * Wraps a real provider so that nothing leaves the building unless it is meant to. Demo accounts never receive a message,
 * and with an allow-list only those numbers do. Skipped messages are reported back, not hidden.
 */
export class GuardedMessageProvider implements MessageProvider {
  constructor(private inner: MessageProvider, private allowed: Set<string>, private allowAll: boolean, private blocked: Set<string>) {}
  async sendSms(phone: string, text: string): Promise<SendResult> {
    if (this.blocked.has(phone) || (!this.allowAll && !this.allowed.has(phone))) {
      logger.info({ to: masked(phone) }, 'sms skipped (not on the allow-list or a demo account)')
      return 'skipped'
    }
    await this.inner.sendSms(phone, text)
    return 'sent'
  }
}

export function createMessageProvider(c: typeof config = config, f?: FetchFn): MessageProvider {
  if (c.SMS_PROVIDER === 'console') return new ConsoleMessageProvider()
  const real = new TwilioMessageProvider({
    accountSid: c.TWILIO_ACCOUNT_SID, authToken: c.TWILIO_AUTH_TOKEN, from: c.TWILIO_FROM || undefined,
    messagingServiceSid: c.TWILIO_MESSAGING_SERVICE_SID || undefined, defaultCountryCode: c.SMS_DEFAULT_COUNTRY_CODE, fetch: f,
  })
  return new GuardedMessageProvider(real, c.smsAllowed, c.SMS_ALLOW_ALL, c.demoPhones)
}
