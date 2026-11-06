import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const paymentRepo = {
  byIdempotencyKey: (idempotencyKey: string) => prisma.payment.findUnique({ where: { idempotencyKey } }),
  create: (data: Prisma.PaymentUncheckedCreateInput) => prisma.payment.create({ data }),
  byIdWithReceipt: (id: string) => prisma.payment.findUnique({ where: { id }, include: { receipt: true } }),
  successfulPage: (flatId: string, skip: number, take: number) => {
    const where = { flatId, status: 'SUCCESS' as const }
    return Promise.all([
      prisma.payment.findMany({ where, orderBy: { paidAt: 'desc' }, skip, take, include: { receipt: true } }),
      prisma.payment.count({ where }),
    ])
  },
  primaryMemberName: (flatId: string) =>
    prisma.flatMember.findFirst({ where: { flatId, active: true }, include: { user: { select: { name: true } } }, orderBy: { relation: 'asc' } }),
}
