import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/lib/config.js'
import { usesFixedCode } from '../src/modules/auth/service.js'

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

  describe('demo accounts in production', () => {
    const prod = { ...base, NODE_ENV: 'production', DEMO_OTP_PHONES: '9800000001, 9800000010' }
    it('lists the demo phones and still refuses the global fixed code', () => {
      const c = loadConfig(prod)
      expect([...c.demoPhones]).toEqual(['9800000001', '9800000010'])
      expect(loadConfig({ ...base, NODE_ENV: 'production' }).demoPhones.size).toBe(0)
      expect(() => loadConfig({ ...prod, OTP_FIXED_CODE_ENABLED: 'true' })).toThrow(/OTP_FIXED_CODE_ENABLED/)
    })
    it('gives the fixed code only to listed phones', () => {
      const c = loadConfig(prod)
      expect(usesFixedCode('9800000001', c)).toBe(true)
      expect(usesFixedCode('9811111111', c)).toBe(false)
    })
  })
})
