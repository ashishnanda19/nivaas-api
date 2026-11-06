import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const auditRepo = {
  page: (where: Prisma.AuditLogWhereInput, skip: number, take: number) =>
    Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }), prisma.auditLog.count({ where })]),
}
