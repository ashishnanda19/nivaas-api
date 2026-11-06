import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, guard, OPS } from '../../lib/auth.js'
import { prisma } from '../../lib/db.js'
import { notFound } from '../../lib/errors.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import { writeAudit } from '../audit/service.js'
import { noticeRepo as repo } from './repo.js'

export const noticeBody = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(4000) }).strict()
const view = (n: { id: string; title: string; body: string; createdAt: Date }) => ({ id: n.id, title: n.title, body: n.body, at: n.createdAt.toISOString() })

export async function noticeRoutes(app: FastifyInstance) {
  app.get('/notices', { preHandler: guard({ roles: ['RESIDENT', 'HELPDESK', 'COMMITTEE', 'GUARD'] }) }, async (req) => {
    const q = parse(pageQuery, req.query)
    const [items, total] = await repo.page(pageArgs(q).skip, pageArgs(q).take)
    return { items: items.map(view), page: q.page, pageSize: q.pageSize, total }
  })

  app.post('/notices', { preHandler: guard({ roles: OPS }) }, async (req) => {
    const n = await repo.create(parse(noticeBody, req.body))
    await writeAudit(prisma, actorOf(req), { action: 'notice.create', entity: 'Notice', entityId: n.id, after: { title: n.title } })
    return view(n)
  })

  app.delete('/notices/:id', { preHandler: guard({ roles: OPS }) }, async (req) => {
    const id = (req.params as { id: string }).id
    const n = await repo.byId(id)
    if (!n) throw notFound('Notice not found')
    await repo.remove(id)
    await writeAudit(prisma, actorOf(req), { action: 'notice.delete', entity: 'Notice', entityId: id, before: { title: n.title } })
    return { ok: true }
  })
}
