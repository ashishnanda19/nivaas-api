import crypto from 'node:crypto'
import argon2 from 'argon2'
import type { Role } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { config } from '../../lib/config.js'
import { AppError, badRequest, tooMany, unauthorized } from '../../lib/errors.js'
import { hashToken, newRefreshToken, REFRESH_TTL_SEC, signAccess } from '../../lib/auth.js'
import { writeAudit } from '../audit/service.js'
import type { MessageProvider } from './messages.js'

export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_REQUESTS_PER_WINDOW = 3
export const OTP_WINDOW_MS = 10 * 60 * 1000
/** With the fixed demo code on, repeated sign-ins are normal, so the cap is looser. Real OTPs keep the strict cap. */
export const OTP_MAX_REQUESTS_FIXED_MODE = 20
export const otpRequestCap = (fixedMode: boolean) => (fixedMode ? OTP_MAX_REQUESTS_FIXED_MODE : OTP_MAX_REQUESTS_PER_WINDOW)

const FIXED = '123456'

export async function requestOtp(phone: string, sms: MessageProvider, now = new Date()) {
  const since = new Date(now.getTime() - OTP_WINDOW_MS)
  const recent = await prisma.otp.count({ where: { phone, createdAt: { gte: since } } })
  const cap = otpRequestCap(config.OTP_FIXED_CODE_ENABLED)
  if (recent >= cap) throw tooMany('Too many codes requested for this number. Try again in a few minutes.')

  const user = await prisma.user.findUnique({ where: { phone } })
  // Same response whether or not the number is registered, so numbers cannot be enumerated.
  const code = config.OTP_FIXED_CODE_ENABLED ? FIXED : crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  await prisma.otp.create({
    data: { phone, codeHash: await argon2.hash(code), expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
  })
  if (user) await sms.sendSms(phone, `Your Nivaas code is ${code}. It expires in 5 minutes.`)
  return { sent: true, expiresInSec: OTP_TTL_MS / 1000 }
}

export async function verifyOtp(phone: string, code: string, ip: string | undefined, now = new Date()) {
  const otp = await prisma.otp.findFirst({
    where: { phone, usedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!otp || otp.expiresAt < now) throw new AppError(401, 'OTP_INVALID', 'Code expired or not requested. Ask for a new one.')
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Too many wrong codes. Ask for a new one.')
  await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } })
  if (!(await argon2.verify(otp.codeHash, code))) throw new AppError(401, 'OTP_INVALID', 'That code is not right.')

  const user = await prisma.user.findUnique({ where: { phone } })
  if (!user) throw new AppError(401, 'OTP_INVALID', 'That code is not right.')
  await prisma.otp.update({ where: { id: otp.id }, data: { usedAt: now } })
  return issueSession(user.id, ip)
}

export async function issueSession(userId: string, ip?: string) {
  const refresh = newRefreshToken()
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(refresh), expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000) },
  })
  const user = await publicUser(userId)
  await writeAudit(prisma, { id: userId, name: user.name, role: user.role, ip }, {
    action: 'auth.login', entity: 'User', entityId: userId,
  })
  return { accessToken: signAccess(userId), refreshToken: refresh, user }
}

export async function refreshSession(token: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    if (row?.revokedAt) {
      // A rotated token was presented again: assume theft and revoke every session for the user.
      await prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } })
    }
    throw unauthorized('Session expired')
  }
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } })
  const next = newRefreshToken()
  await prisma.refreshToken.create({
    data: { userId: row.userId, tokenHash: hashToken(next), expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000) },
  })
  return { accessToken: signAccess(row.userId), refreshToken: next, user: await publicUser(row.userId) }
}

export async function logout(token?: string) {
  if (!token) return
  await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } })
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
  const u = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { members: { where: { active: true }, orderBy: { id: 'asc' } } },
  })
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
  const u = await prisma.user.update({ where: { id: userId }, data: { consentAt: new Date() } })
  await writeAudit(prisma, { id: u.id, name: u.name, role: u.role, ip }, {
    action: 'consent.record', entity: 'User', entityId: u.id, detail: 'DPDP Act 2023 notice accepted',
  })
  return publicUser(userId)
}

export async function setLanguage(userId: string, language: string) {
  if (!['en', 'hi', 'mr'].includes(language)) throw badRequest('Unsupported language')
  await prisma.user.update({ where: { id: userId }, data: { language } })
  return publicUser(userId)
}
