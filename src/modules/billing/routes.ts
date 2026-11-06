import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, assertFlatAccess, guard, OPS } from '../../lib/auth.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import { notFound } from '../../lib/errors.js'
import * as svc from './service.js'
import { periodOk } from './service.js'

const periodStr = z.string().refine(periodOk, 'period must be YYYY-MM')
export const runBody = z.object({ period: periodStr }).strict()
export const reverseBody = z.object({ flatId: z.string(), reason: z.string().min(3).max(200) }).strict()
const flatQuery = z.object({ flatId: z.string().min(3).max(12) }).passthrough()

export async function billingRoutes(app: FastifyInstance) {
  const any = { preHandler: guard({ roles: ['RESIDENT', 'HELPDESK'] }) }
  const ops = { preHandler: guard({ roles: OPS }) }

  app.get('/billing/bill', any, async (req) => {
    const { flatId } = parse(flatQuery, req.query)
    assertFlatAccess(req.user!, flatId)
    const bill = await svc.currentBill(flatId)
    if (!bill) throw notFound('No bill yet for this flat')
    return bill
  })

  app.get('/billing/bills', any, async (req) => {
    const { flatId } = parse(flatQuery, req.query)
    assertFlatAccess(req.user!, flatId)
    return { items: await svc.billHistory(flatId) }
  })

  app.get('/billing/ledger', any, async (req) => {
    // strip, not passthrough: passthrough would keep page as the text "1" and clash with the number the pagination schema makes of it
    const q = parse(flatQuery.strip().and(pageQuery), req.query)
    assertFlatAccess(req.user!, q.flatId)
    const r = await svc.ledgerFor(q.flatId, pageArgs(q))
    return { items: r.rows, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/billing/runs', ops, async () => ({ items: await svc.listBillRuns() }))

  app.get('/billing/runs/preview', ops, async (req) => {
    const { period } = parse(z.object({ period: periodStr }), req.query)
    return svc.billRunPreview(period)
  })

  app.post('/billing/runs', ops, async (req) => {
    const { period } = parse(runBody, req.body)
    return svc.billRunPublish(period, actorOf(req))
  })

  app.post('/billing/ledger/:id/reverse', ops, async (req) => {
    const { id } = req.params as { id: string }
    const b = parse(reverseBody, req.body)
    return svc.reverseEntry(b.flatId, id, b.reason, actorOf(req))
  })
}
