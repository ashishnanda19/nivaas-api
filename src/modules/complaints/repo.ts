import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const INCLUDE = { updates: { orderBy: { createdAt: 'asc' as const } } }

export const complaintRepo = {
  flatWithMembers: (id: string) => prisma.flat.findUnique({ where: { id }, include: { members: { include: { user: { select: { name: true } } } } } }),

  linkedChildIds: async () => (await prisma.complaintLink.findMany({ select: { childId: true } })).map((l) => l.childId),
  page: (where: Prisma.ComplaintWhereInput, skip: number, take: number) =>
    Promise.all([
      prisma.complaint.findMany({ where, include: INCLUDE, orderBy: [{ escalated: 'desc' }, { createdAt: 'desc' }], skip, take }),
      prisma.complaint.count({ where }),
    ]),
  scopedByCode: (code: string, scope: Prisma.ComplaintWhereInput) => prisma.complaint.findFirst({ where: { AND: [{ code }, scope] }, include: INCLUDE }),
  photoPathOf: (code: string) => prisma.complaint.findUnique({ where: { code }, select: { photoPath: true } }),

  /** The lookups needed to turn a page of complaints into views, in one round trip. */
  related: (authorIds: string[], ids: string[]) =>
    Promise.all([
      prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }),
      prisma.staffMember.findMany({ select: { id: true, name: true } }),
      prisma.complaintLink.findMany({ where: { childId: { in: ids } } }),
      prisma.complaintLink.groupBy({ by: ['parentId'], where: { parentId: { in: ids } }, _count: true }),
    ]),
  codesOf: (ids: string[]) => prisma.complaint.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } }),
  childLinks: (parentId: string) => prisma.complaintLink.findMany({ where: { parentId } }),
  childSummaries: (ids: string[]) =>
    prisma.complaint.findMany({ where: { id: { in: ids } }, select: { code: true, flatId: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  linkOfChild: (childId: string) => prisma.complaintLink.findUnique({ where: { childId } }),
  countChildren: (parentId: string) => prisma.complaintLink.count({ where: { parentId } }),

  staffById: (id: string) => prisma.staffMember.findUnique({ where: { id } }),
  staffAll: () => prisma.staffMember.findMany({ orderBy: { name: 'asc' } }),
  setRating: (id: string, rating: number) => prisma.complaint.update({ where: { id }, data: { rating } }),
  markOverdue: (now: Date) =>
    prisma.complaint.updateMany({
      where: { responseDueAt: { lt: now }, firstResponseAt: null, overdueAt: null, status: { not: 'RESOLVED' } },
      data: { overdueAt: now },
    }),
}
