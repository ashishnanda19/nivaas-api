import { z } from 'zod'

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export function pageArgs(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize }
}

export function paged<T>(items: T[], total: number, q: { page: number; pageSize: number }) {
  return { items, page: q.page, pageSize: q.pageSize, total, pages: Math.max(1, Math.ceil(total / q.pageSize)) }
}
