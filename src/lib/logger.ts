import { createRequire } from 'node:module'
import pino from 'pino'
import { config } from './config.js'

/** pino-pretty is a dev dependency; a container built with --omit=dev falls back to JSON logs. */
const hasPretty = (() => { try { createRequire(import.meta.url).resolve('pino-pretty'); return true } catch { return false } })()

export const logger = pino({
  level: config.NODE_ENV === 'test' ? (process.env.TEST_LOG ?? 'silent') : config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', '*.password', '*.token', '*.code', '*.otp'],
    censor: '[redacted]',
  },
  transport:
    config.NODE_ENV === 'development' && hasPretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
})
