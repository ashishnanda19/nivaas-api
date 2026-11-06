import type { FastifyInstance, FastifyRequest } from 'fastify'
import { actorOf, assertFlatAccess, guard, verifyFileToken } from '../../lib/auth.js'
import { forbidden } from '../../lib/errors.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import * as s from './schema.js'
import * as svc from './service.js'

export async function visitorRoutes(app: FastifyInstance) {
  const gate = { preHandler: guard({ roles: ['GUARD'] }) }
  const read = { preHandler: guard({ roles: ['GUARD', 'RESIDENT', 'HELPDESK'] }) }
  const resident = { preHandler: guard({ roles: ['RESIDENT'] }) }
  const id = (r: FastifyRequest) => (r.params as { id: string }).id

  // Flat picker for the gate tablet: flat ids and abbreviated names only, no phones, dues or members.
  app.get('/gate/flats', { preHandler: guard({ roles: ['GUARD', 'HELPDESK'] }) }, async (req) => {
    const q = parse(pageQuery, req.query)
    const r = await svc.gateFlats(pageArgs(q))
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/gates', read, async () => ({ items: await svc.listGates() }))

  app.post('/visitors', { ...gate, bodyLimit: 3_500_000 }, async (req) => {
    const b = parse(s.entry, req.body)
    const r = await svc.createEntry(req.user!, b)
    return { ...svc.view(r.visitor, req.user!), created: r.created }
  })

  app.post('/visitors/sync', { ...gate, bodyLimit: 20_000_000 }, async (req) => svc.syncEntries(req.user!, parse(s.syncBody, req.body).entries))

  app.get('/visitors', read, async (req) => {
    const q = parse(s.listQuery, req.query)
    if (q.flatId) assertFlatAccess(req.user!, q.flatId)
    const r = await svc.listVisitors(req.user!, actorOf(req), { ...q, ...pageArgs(q) })
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/visitors/:id', read, async (req) => svc.getVisitor(req.user!, id(req)))
  app.post('/visitors/:id/decision', resident, async (req) => svc.decide(req.user!, actorOf(req), id(req), parse(s.decisionBody, req.body).decision))
  app.post('/visitors/:id/status', gate, async (req) => svc.gateStatus(req.user!, actorOf(req), id(req), parse(s.gateStatusBody, req.body).status))

  app.post('/pre-approvals', resident, async (req) => {
    const b = parse(s.preApprovalBody, req.body)
    assertFlatAccess(req.user!, b.flatId)
    return svc.createPreApproval(req.user!, b)
  })
  app.get('/pre-approvals', resident, async (req) => {
    const { flatId } = parse(s.preApprovalBody.pick({ flatId: true }), req.query)
    assertFlatAccess(req.user!, flatId)
    return { items: await svc.listPreApprovals(flatId) }
  })
  app.post('/pre-approvals/verify', { ...gate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = parse(s.verifyBody, req.body)
    return svc.verifyCode(req.user!, actorOf(req), b.code, b.gateId)
  })

  app.get('/files/visitors/:id', async (req, reply) => {
    const { t } = req.query as { t?: string }
    if (!t || !verifyFileToken(t, `visitor:${id(req)}`)) throw forbidden('Link expired')
    const { buf, mime } = await svc.photoFor(id(req))
    reply.header('content-type', mime).header('cache-control', 'private, max-age=300').header('x-content-type-options', 'nosniff')
    return reply.send(buf)
  })
}
