import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const authRepo = {
  userByPhone: (phone: string) => prisma.user.findUnique({ where: { phone } }),
  userWithMemberships: (id: string) =>
    prisma.user.findUniqueOrThrow({ where: { id }, include: { members: { where: { active: true }, orderBy: { id: 'asc' } } } }),
  setConsent: (id: string) => prisma.user.update({ where: { id }, data: { consentAt: new Date() } }),
  setLanguage: (id: string, language: string) => prisma.user.update({ where: { id }, data: { language } }),

  countOtpsSince: (phone: string, since: Date) => prisma.otp.count({ where: { phone, createdAt: { gte: since } } }),
  createOtp: (data: Prisma.OtpUncheckedCreateInput) => prisma.otp.create({ data }),
  latestOpenOtp: (phone: string) => prisma.otp.findFirst({ where: { phone, usedAt: null }, orderBy: { createdAt: 'desc' } }),
  countOtpAttempt: (id: string) => prisma.otp.update({ where: { id }, data: { attempts: { increment: 1 } } }),
  markOtpUsed: (id: string, at: Date) => prisma.otp.update({ where: { id }, data: { usedAt: at } }),

  createRefresh: (userId: string, tokenHash: string, expiresAt: Date) => prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } }),
  refreshByHash: (tokenHash: string) => prisma.refreshToken.findUnique({ where: { tokenHash } }),
  revokeRefresh: (id: string) => prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }),
  revokeAllRefresh: (userId: string) => prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  revokeRefreshByHash: (tokenHash: string) => prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } }),
}
