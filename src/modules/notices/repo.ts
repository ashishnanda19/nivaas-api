import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const noticeRepo = {
  page: (skip: number, take: number) => Promise.all([prisma.notice.findMany({ orderBy: { createdAt: 'desc' }, skip, take }), prisma.notice.count()]),
  create: (data: Prisma.NoticeCreateInput) => prisma.notice.create({ data }),
  byId: (id: string) => prisma.notice.findUnique({ where: { id } }),
  remove: (id: string) => prisma.notice.delete({ where: { id } }),
}
