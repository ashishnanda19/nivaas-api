import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, guard } from '../../lib/auth.js'
import { parse } from '../../lib/validate.js'
import { periodOk } from '../billing/service.js'
import { writeAudit } from '../audit/service.js'
import { prisma } from '../../lib/db.js'
import { reportCsv, reportPdf } from './report.js'
import * as svc from './service.js'

export async function committeeRoutes(app: FastifyInstance) {
  // Committee gets aggregates only. The help desk may read them too.
  const g = { preHandler: guard({ roles: ['COMMITTEE', 'HELPDESK'] }) }
  const period = z.object({ period: z.string().refine(periodOk, 'period must be YYYY-MM') })

  app.get('/committee/dashboard', g, async (req) => {
    const q = parse(z.object({ months: z.coerce.number().int().min(1).max(12).default(6), tower: z.coerce.number().int().min(1).max(28).optional() }), req.query)
    return svc.dashboard(q.months, new Date(), q.tower)
  })

  app.get('/committee/complaints', g, async () => svc.complaintMetrics())

  app.get('/committee/report.csv', g, async (req, reply) => {
    const { period: p } = parse(period, req.query)
    const r = await svc.monthlyReport(p)
    await writeAudit(prisma, actorOf(req), { action: 'report.export', entity: 'Report', entityId: p, detail: 'csv' })
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="nivaas-report-${p}.csv"`)
    return reply.send(reportCsv(r))
  })

  app.get('/committee/report.pdf', g, async (req, reply) => {
    const { period: p } = parse(period, req.query)
    const r = await svc.monthlyReport(p)
    await writeAudit(prisma, actorOf(req), { action: 'report.export', entity: 'Report', entityId: p, detail: 'pdf' })
    reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="nivaas-report-${p}.pdf"`)
    return reply.send(await reportPdf(r))
  })
}
