import { logger } from '../../lib/logger.js'

export interface MessageProvider {
  sendSms(phone: string, text: string): Promise<void>
}

/** Development provider: logs that a message was sent, never the content of an OTP. */
export class ConsoleMessageProvider implements MessageProvider {
  async sendSms(phone: string) {
    logger.info({ to: `${phone.slice(0, 3)}*****${phone.slice(-2)}` }, 'sms sent (console provider)')
  }
}

export const sentMessages: { phone: string; text: string }[] = []

/** Test provider keeps messages in memory so tests can read the OTP. */
export class MemoryMessageProvider implements MessageProvider {
  async sendSms(phone: string, text: string) {
    sentMessages.push({ phone, text })
  }
}
