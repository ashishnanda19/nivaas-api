import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, assertFlatAccess, guard, OPS } from '../../lib/auth.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import { phone } from '../auth/schema.js'
import * as svc from './service.js'

export async function flatRoutes(app: FastifyInstance) {
  const res = { preHandler: guard({ roles: ['RESIDENT', 'HELPDESK'] }) }
  const ops = { preHandler: guard({ roles: OPS }) }

  app.get('/flats', ops, async (req) => {
    const q = parse(z.object({ search: z.string().max(50).optional(), tower: z.coerce.number().int().min(1).max(28).optional() }).and(pageQuery), req.query)
    const r = await svc.listFlats({ search: q.search, tower: q.tower, ...pageArgs(q) })
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/flats/:id/summary', res, async (req) => {
    const { id } = req.params as { id: string }
    assertFlatAccess(req.user!, id)
    return svc.flatSummary(id)
  })

  app.get('/flats/:id/members', res, async (req) => {
    const { id } = req.params as { id: string }
    assertFlatAccess(req.user!, id)
    const { reveal } = parse(z.object({ reveal: z.enum(['true', 'false']).optional() }), req.query)
    return { items: await svc.listMembers(id, req.user!, actorOf(req), reveal === 'true') }
  })

  app.post('/flats/:id/members', res, async (req) => {
    const { id } = req.params as { id: string }
    assertFlatAccess(req.user!, id)
    const b = parse(z.object({ name: z.string().min(2).max(80), phone, relation: z.enum(['OWNER', 'FAMILY', 'TENANT']) }).strict(), req.body)
    return svc.addMember(id, req.user!, actorOf(req), b)
  })

  app.delete('/flats/:id/members/:memberId', res, async (req) => {
    const { id, memberId } = req.params as { id: string; memberId: string }
    assertFlatAccess(req.user!, id)
    return svc.removeMember(id, memberId, req.user!, actorOf(req))
  })
}
