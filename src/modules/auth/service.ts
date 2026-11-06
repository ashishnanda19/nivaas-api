import crypto from 'node:crypto'
import type { Role } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { config } from '../../lib/config.js'
import { AppError, badRequest, tooMany, unauthorized } from '../../lib/errors.js'
import { hashToken, newRefreshToken, REFRESH_TTL_SEC, signAccess } from '../../lib/auth.js'
import { writeAudit } from '../audit/service.js'
import { authRepo as repo } from './repo.js'
import type { MessageProvider } from './messages.js'

export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_REQUESTS_PER_WINDOW = 3
export const OTP_WINDOW_MS = 10 * 60 * 1000
/** With the fixed demo code on, repeated sign-ins are normal, so the cap is looser. Real OTPs keep the strict cap. */
export const OTP_MAX_REQUESTS_FIXED_MODE = 20
export const otpRequestCap = (fixedMode: boolean) => (fixedMode ? OTP_MAX_REQUESTS_FIXED_MODE : OTP_MAX_REQUESTS_PER_WINDOW)

const FIXED = '123456'

/**
 * A one-time code is only six digits, so no hash can protect it if the database leaks; what protects it is that it lives
 * five minutes and allows five tries. It is stored as a keyed HMAC bound to the phone number, not in the clear, and not
 * with a password hash, whose deliberate slowness would only make every sign-in wait.
 */
export const hashOtp = (phone: string, code: string) => crypto.createHmac('sha256', config.JWT_SECRET).update(`otp:${phone}:${code}`).digest('hex')
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** The fixed demo code is accepted when enabled globally (non-production) or for an explicitly listed demo account. */
export const usesFixedCode = (phone: string, cfg: Pick<typeof config, 'OTP_FIXED_CODE_ENABLED' | 'demoPhones'> = config) => cfg.OTP_FIXED_CODE_ENABLED || cfg.demoPhones.has(phone)

export async function requestOtp(phone: string, sms: MessageProvider, now = new Date()) {
  const since = new Date(now.getTime() - OTP_WINDOW_MS)
  const recent = await repo.countOtpsSince(phone, since)
  const cap = otpRequestCap(usesFixedCode(phone))
  if (recent >= cap) throw tooMany('Too many codes requested for this number. Try again in a few minutes.')

  const user = await repo.userByPhone(phone)
  // Same response whether or not the number is registered, so numbers cannot be enumerated.
  const code = usesFixedCode(phone) ? FIXED : crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  await repo.createOtp({ phone, codeHash: hashOtp(phone, code), expiresAt: new Date(now.getTime() + OTP_TTL_MS) })
  if (user) await sms.sendSms(phone, `Your Nivaas code is ${code}. It expires in 5 minutes.`)
  return { sent: true, expiresInSec: OTP_TTL_MS / 1000 }
}

export async function verifyOtp(phone: string, code: string, ip: string | undefined, now = new Date()) {
  const otp = await repo.latestOpenOtp(phone)
  if (!otp || otp.expiresAt < now) throw new AppError(401, 'OTP_INVALID', 'Code expired or not requested. Ask for a new one.')
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Too many wrong codes. Ask for a new one.')
  await repo.countOtpAttempt(otp.id)
  if (!sameHash(otp.codeHash, hashOtp(phone, code))) throw new AppError(401, 'OTP_INVALID', 'That code is not right.')

  const user = await repo.userByPhone(phone)
  if (!user) throw new AppError(401, 'OTP_INVALID', 'That code is not right.')
  await repo.markOtpUsed(otp.id, now)
  return issueSession(user.id, ip)
}

export async function issueSession(userId: string, ip?: string) {
  const refresh = newRefreshToken()
  await repo.createRefresh(userId, hashToken(refresh), new Date(Date.now() + REFRESH_TTL_SEC * 1000))
  const user = await publicUser(userId)
  await writeAudit(prisma, { id: userId, name: user.name, role: user.role, ip }, {
    action: 'auth.login', entity: 'User', entityId: userId,
  })
  return { accessToken: signAccess(userId), refreshToken: refresh, user }
}

export async function refreshSession(token: string) {
  const row = await repo.refreshByHash(hashToken(token))
  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    if (row?.revokedAt) {
      // A rotated token was presented again: assume theft and revoke every session for the user.
      await repo.revokeAllRefresh(row.userId)
    }
    throw unauthorized('Session expired')
  }
  await repo.revokeRefresh(row.id)
  const next = newRefreshToken()
  await repo.createRefresh(row.userId, hashToken(next), new Date(Date.now() + REFRESH_TTL_SEC * 1000))
  return { accessToken: signAccess(row.userId), refreshToken: next, user: await publicUser(row.userId) }
}

export async function logout(token?: string) {
  if (!token) return
  await repo.revokeRefreshByHash(hashToken(token))
}

export interface PublicUser {
  id: string
  name: string
  phone: string
  role: Role
  title: string | null
  language: string
  consent: boolean
  flatId: string | null
  flatIds: string[]
  memberRole: string | null
}

export async function publicUser(id: string): Promise<PublicUser> {
  const u = await repo.userWithMemberships(id)
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    role: u.role,
    title: u.title,
    language: u.language,
    consent: !!u.consentAt,
    flatId: u.members[0]?.flatId ?? null,
    flatIds: u.members.map((m) => m.flatId),
    memberRole: u.members[0]?.relation ?? null,
  }
}

export async function recordConsent(userId: string, ip?: string) {
  const u = await repo.setConsent(userId)
  await writeAudit(prisma, { id: u.id, name: u.name, role: u.role, ip }, {
    action: 'consent.record', entity: 'User', entityId: u.id, detail: 'DPDP Act 2023 notice accepted',
  })
  return publicUser(userId)
}

export async function setLanguage(userId: string, language: string) {
  if (!['en', 'hi', 'mr'].includes(language)) throw badRequest('Unsupported language')
  await repo.setLanguage(userId, language)
  return publicUser(userId)
}
