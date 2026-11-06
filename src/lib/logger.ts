import pino from 'pino'
import { config } from './config.js'

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', '*.password', '*.token', '*.code', '*.otp'],
    censor: '[redacted]',
  },
  transport:
    config.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
})
