import type { MemberRelation, Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const flatRepo = {
  byId: (id: string) => prisma.flat.findUnique({ where: { id } }),

  page: (where: Prisma.FlatWhereInput, skip: number, take: number) =>
    Promise.all([
      prisma.flat.findMany({
        where, orderBy: [{ towerNo: 'asc' }, { number: 'asc' }], skip, take,
        include: { members: { where: { active: true }, include: { user: { select: { name: true } } } }, knownPayers: { select: { upiId: true } } },
      }),
      prisma.flat.count({ where }),
    ]),
  balances: (flatIds: string[]) => prisma.ledgerEntry.groupBy({ by: ['flatId'], where: { flatId: { in: flatIds } }, _sum: { amountPaise: true } }),
  oldestUnpaidBills: (flatIds: string[]) =>
    prisma.bill.findMany({ where: { flatId: { in: flatIds }, status: { not: 'PAID' } }, orderBy: { dueDate: 'asc' }, distinct: ['flatId'] }),

  openComplaints: (flatId: string) => prisma.complaint.count({ where: { flatId, status: { not: 'RESOLVED' } } }),
  visitorsSince: (flatId: string, since: Date) => prisma.visitor.count({ where: { flatId, createdAt: { gte: since } } }),
  waitingVisitors: (flatId: string) => prisma.visitor.count({ where: { flatId, status: 'WAITING' } }),

  activeMembers: (flatId: string) => prisma.flatMember.findMany({ where: { flatId, active: true }, include: { user: true }, orderBy: { id: 'asc' } }),
  activeMembership: (flatId: string, userId: string) => prisma.flatMember.findFirst({ where: { flatId, userId, active: true } }),
  activeMemberById: (flatId: string, id: string) => prisma.flatMember.findFirst({ where: { id, flatId, active: true } }),
  membership: (userId: string, flatId: string) => prisma.flatMember.findUnique({ where: { userId_flatId: { userId, flatId } } }),
  reactivate: (id: string, relation: MemberRelation) => prisma.flatMember.update({ where: { id }, data: { active: true, relation } }),
  addMember: (userId: string, flatId: string, relation: MemberRelation) => prisma.flatMember.create({ data: { userId, flatId, relation } }),
  deactivate: (id: string) => prisma.flatMember.update({ where: { id }, data: { active: false } }),

  upsertResident: (phone: string, name: string) => prisma.user.upsert({ where: { phone }, update: {}, create: { phone, name, role: 'RESIDENT' } }),
}
