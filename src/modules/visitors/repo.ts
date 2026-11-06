import type { Prisma, VisitorStatus } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const visitorRepo = {
  byClientId: (clientId: string) => prisma.visitor.findUnique({ where: { clientId } }),
  create: (data: Prisma.VisitorUncheckedCreateInput) => prisma.visitor.create({ data }),
  page: (where: Prisma.VisitorWhereInput, skip: number, take: number) =>
    Promise.all([prisma.visitor.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }), prisma.visitor.count({ where })]),
  scopedById: (id: string, scope: Prisma.VisitorWhereInput) => prisma.visitor.findFirst({ where: { AND: [{ id }, scope] } }),
  /** Moves a visitor only if it is still in `from`. Returns how many rows changed (0 = someone else got there first). */
  transition: (id: string, from: VisitorStatus, data: Prisma.VisitorUpdateManyMutationInput) => prisma.visitor.updateMany({ where: { id, status: from }, data }),
  photoPathOf: (id: string) => prisma.visitor.findUnique({ where: { id }, select: { photoPath: true } }),
  photosDue: (now: Date) => prisma.visitor.findMany({ where: { photoPath: { not: null }, photoDeleteAfter: { lt: now } }, select: { id: true, photoPath: true } }),
  clearPhoto: (id: string) => prisma.visitor.update({ where: { id }, data: { photoPath: null } }),

  flatExists: (id: string) => prisma.flat.findUnique({ where: { id } }),
  gateById: (id: string) => prisma.gate.findUnique({ where: { id } }),
  gates: () => prisma.gate.findMany({ orderBy: { id: 'asc' } }),
  flatsPage: (skip: number, take: number) =>
    Promise.all([
      prisma.flat.findMany({
        orderBy: [{ towerNo: 'asc' }, { number: 'asc' }], skip, take,
        include: { members: { where: { active: true, relation: { in: ['OWNER', 'TENANT'] } }, include: { user: { select: { name: true } } }, take: 1 } },
      }),
      prisma.flat.count(),
    ]),

  createPreApproval: (data: Prisma.PreApprovalUncheckedCreateInput) => prisma.preApproval.create({ data }),
  preApprovalsFor: (flatId: string) => prisma.preApproval.findMany({ where: { flatId }, orderBy: { date: 'desc' }, take: 50 }),
  preApprovalByHash: (codeHash: string) => prisma.preApproval.findUnique({ where: { codeHash } }),
}
