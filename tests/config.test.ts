import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/lib/config.js'

const base = {
  NODE_ENV: 'development', DATABASE_URL: 'postgresql://x@localhost/x', JWT_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32),
  PAYMENT_WEBHOOK_SECRET: 'whsec-123456',
}

describe('config', () => {
  it('boots with only the required variables and no AI keys', () => {
    const c = loadConfig(base)
    expect(c).toMatchObject({ PORT: 4000, GEMINI_API_KEY: '', GROQ_API_KEY: '', OTP_FIXED_CODE_ENABLED: false })
    expect(c.corsOrigins).toEqual(['http://localhost:5173'])
  })
  it('fails fast and names what is wrong', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/)
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/)
  })
  it('refuses the fixed OTP and placeholder secrets in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', OTP_FIXED_CODE_ENABLED: 'true' })).toThrow(/OTP_FIXED_CODE_ENABLED/)
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', JWT_SECRET: 'change-me-to-a-long-random-string-32chars' })).toThrow(/Placeholder/)
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).isProd).toBe(true)
  })
  it('splits the CORS allow-list', () => {
    expect(loadConfig({ ...base, CORS_ORIGINS: 'https://a.app, https://b.app' }).corsOrigins).toEqual(['https://a.app', 'https://b.app'])
  })
})
