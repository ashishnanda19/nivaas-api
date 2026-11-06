import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { guard } from '../../lib/auth.js'
import { auditRepo } from './repo.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: guard({ roles: ['HELPDESK', 'COMMITTEE'] }) }, async (req) => {
    const q = parse(
      z.object({
        actor: z.string().max(80).optional(),
        action: z.string().max(60).optional(),
        entity: z.string().max(40).optional(),
        entityId: z.string().max(60).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).and(pageQuery),
      req.query,
    )
    const where = {
      ...(q.actor ? { actorName: { contains: q.actor, mode: 'insensitive' as const } } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    }
    const [items, total] = await auditRepo.page(where, pageArgs(q).skip, pageArgs(q).take)
    return { items, page: q.page, pageSize: q.pageSize, total }
  })
}
