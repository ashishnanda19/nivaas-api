import type { FastifyInstance } from 'fastify'
import { actorOf, guard } from '../../lib/auth.js'
import { config } from '../../lib/config.js'
import { parse } from '../../lib/validate.js'
import { unauthorized } from '../../lib/errors.js'
import { REFRESH_TTL_SEC } from '../../lib/auth.js'
import { consentBody, languageBody, otpRequest, otpVerify } from './schema.js'
import * as svc from './service.js'
import type { MessageProvider } from './messages.js'

const COOKIE = 'nivaas_rt'

export function authRoutes(sms: MessageProvider) {
  return async (app: FastifyInstance) => {
    const cookieOpts = {
      httpOnly: true,
      secure: config.isProd,
      sameSite: (config.isProd ? 'none' : 'lax') as 'none' | 'lax',
      path: '/api/v1/auth',
      maxAge: REFRESH_TTL_SEC,
    }
    const authLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

    app.post('/auth/otp/request', authLimit, async (req) => {
      const { phone } = parse(otpRequest, req.body)
      return svc.requestOtp(phone, sms)
    })

    app.post('/auth/otp/verify', authLimit, async (req, reply) => {
      const { phone, code } = parse(otpVerify, req.body)
      const s = await svc.verifyOtp(phone, code, req.ip)
      reply.setCookie(COOKIE, s.refreshToken, cookieOpts)
      return { accessToken: s.accessToken, user: s.user }
    })

    app.post('/auth/refresh', authLimit, async (req, reply) => {
      const token = (req.cookies as Record<string, string | undefined>)[COOKIE]
      if (!token) throw unauthorized()
      const s = await svc.refreshSession(token)
      reply.setCookie(COOKIE, s.refreshToken, cookieOpts)
      return { accessToken: s.accessToken, user: s.user }
    })

    app.post('/auth/logout', async (req, reply) => {
      await svc.logout((req.cookies as Record<string, string | undefined>)[COOKIE])
      reply.clearCookie(COOKIE, { path: cookieOpts.path })
      return { ok: true }
    })

    app.get('/auth/me', { preHandler: guard({ allowNoConsent: true }) }, async (req) => svc.publicUser(req.user!.id))

    app.post('/auth/consent', { preHandler: guard({ allowNoConsent: true }) }, async (req) => {
      parse(consentBody, req.body)
      return svc.recordConsent(req.user!.id, actorOf(req).ip ?? undefined)
    })

    app.patch('/auth/language', { preHandler: guard() }, async (req) => {
      const { language } = parse(languageBody, req.body)
      return svc.setLanguage(req.user!.id, language)
    })
  }
}
